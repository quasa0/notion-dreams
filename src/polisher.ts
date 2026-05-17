import type { DreamsConfig } from "./config.js";
import type { EditableBlock } from "./types.js";

export type PolishResult = {
  text: string;
  reason: string;
  changed: boolean;
  skippedReason?: string;
};

export async function polishBlock(
  block: EditableBlock,
  config: DreamsConfig,
): Promise<PolishResult> {
  const original = block.text.trim();

  if (original.length < config.minTextLength) {
    return skip("too short to improve safely");
  }

  if (looksRisky(original)) {
    return skip("contains high-risk wording, dates, or commitments");
  }

  const llmResult = await polishWithOpenAI(original, config);
  const polished = (llmResult || heuristicPolish(original)).trim();

  if (!polished || polished === original) {
    return skip("already clear");
  }

  const validation = validateRewrite(original, polished);
  if (!validation.ok) {
    return skip(validation.reason);
  }

  return {
    text: polished,
    reason: llmResult ? "LLM wording cleanup" : "local filler cleanup",
    changed: true,
  };
}

async function polishWithOpenAI(text: string, config: DreamsConfig): Promise<string | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        {
          role: "system",
          content:
            "You polish Notion text. Make the text clearer and shorter while preserving every fact, name, date, number, link, TODO, decision, and technical term. Do not add facts. Return only the revised text.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    return undefined;
  }

  const json = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  return json.output_text || json.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
}

function heuristicPolish(text: string): string {
  return text
    .replace(/\b(just|really|very|basically|actually|kind of|sort of|pretty much)\b/gi, "")
    .replace(/\b(in order to)\b/gi, "to")
    .replace(/\b(due to the fact that)\b/gi, "because")
    .replace(/\b(at this point in time)\b/gi, "now")
    .replace(/\b(for the purpose of)\b/gi, "to")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function validateRewrite(before: string, after: string): { ok: true } | { ok: false; reason: string } {
  if (after.length > before.length * 1.15) {
    return { ok: false, reason: "rewrite got longer" };
  }

  if (after.length < before.length * 0.45) {
    return { ok: false, reason: "rewrite removed too much text" };
  }

  const beforeTokens = importantTokens(before);
  const afterLower = after.toLowerCase();
  const missing = beforeTokens.filter((token) => !afterLower.includes(token.toLowerCase()));

  if (missing.length > 0) {
    return { ok: false, reason: `missing important token(s): ${missing.slice(0, 5).join(", ")}` };
  }

  return { ok: true };
}

function importantTokens(text: string): string[] {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  const dates = text.match(/\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/g) ?? [];
  const numbers = text.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
  const todos = text.match(/\b(?:TODO|FIXME|MUST|SHOULD|DUE|DEADLINE)\b/g) ?? [];
  const names = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  return [...new Set([...urls, ...dates, ...numbers, ...todos, ...names])];
}

function looksRisky(text: string): boolean {
  return /\b(contract|legal|invoice|payment|deadline|launch date|commitment|must not change)\b/i.test(text);
}

function skip(reason: string): PolishResult {
  return { text: "", reason: "", changed: false, skippedReason: reason };
}
