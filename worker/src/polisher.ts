import type { DreamsConfig } from "./config.js";
import type { EditableBlock } from "./types.js";

export type PolishResult = {
  text: string;
  reason: string;
  changed: boolean;
  skippedReason?: string;
};

type ModelPolishResult =
  | { ok: true; items: Array<{ id: string; text: string }> }
  | { ok: false; reason: string };

export async function polishBlock(block: EditableBlock, config: DreamsConfig): Promise<PolishResult> {
  return (await polishBlocks([block], config))[0] ?? skip("not changed");
}

export async function polishBlocks(blocks: EditableBlock[], config: DreamsConfig): Promise<PolishResult[]> {
  const originals = blocks.map((block) => block.text.trim());
  const results = originals.map((original) => precheck(original, config));
  const modelInputs = blocks
    .map((block, index) => ({ block, index, original: originals[index] ?? "" }))
    .filter((item) => !results[item.index]);

  if (modelInputs.length === 0) {
    return results.map((result) => result ?? skip("not changed"));
  }

  const llmResult = await polishPageWithOpenAI(
    modelInputs.map((item) => ({ id: item.block.id, type: item.block.type, text: item.original })),
    config,
  );
  const byId = llmResult.ok ? new Map(llmResult.items.map((item) => [item.id, item.text])) : new Map<string, string>();

  for (const item of modelInputs) {
    const heuristic = heuristicPolish(item.original);
    const polished = (byId.get(item.block.id) || heuristic).trim();

    if (!polished || polished === item.original) {
      results[item.index] = skip(llmResult.ok ? "already clear" : `${llmResult.reason}; no local cleanup`);
      continue;
    }

    const validation = validateRewrite(item.original, polished);
    if (!validation.ok) {
      results[item.index] = skip(validation.reason);
      continue;
    }

    results[item.index] = {
      text: polished,
      reason: byId.has(item.block.id) ? "LLM page-level wording cleanup" : "local filler cleanup",
      changed: true,
    };
  }

  return results.map((result) => result ?? skip("not changed"));
}

function precheck(original: string, config: DreamsConfig): PolishResult | undefined {
  if (original.length < config.minTextLength) {
    return skip("too short to improve safely");
  }

  if (looksRisky(original)) {
    return skip("contains high-risk wording, dates, or commitments");
  }

  return undefined;
}

async function polishPageWithOpenAI(
  blocks: Array<{ id: string; type: string; text: string }>,
  config: DreamsConfig,
): Promise<ModelPolishResult> {
  const apiKey = process.env.DREAMS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "OpenAI unavailable: missing API key" };

  try {
    let response = await fetchWithTimeout("https://api.openai.com/v1/responses", responseRequest(apiKey, config, blocks, true));

    if (response.status === 400) {
      response = await fetchWithTimeout("https://api.openai.com/v1/responses", responseRequest(apiKey, config, blocks, false));
    }

    if (!response.ok) {
      return { ok: false, reason: `OpenAI unavailable: HTTP ${response.status}` };
    }

    const json = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const output =
      json.output_text ||
      json.output
        ?.flatMap((item) => item.content ?? [])
        .map((item) => item.text ?? "")
        .join("");
    if (!output) return { ok: false, reason: "OpenAI unavailable: empty response" };

    return parseModelOutput(output);
  } catch {
    return { ok: false, reason: "OpenAI unavailable: request failed" };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function responseRequest(
  apiKey: string,
  config: DreamsConfig,
  blocks: Array<{ id: string; type: string; text: string }>,
  includeReasoning: boolean,
): RequestInit {
  return {
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
          content: [
            "You polish editable Notion blocks from one page.",
            "Make wording clearer, tighter, and less repetitive while preserving every fact, name, date, number, link, TODO, decision, and technical term.",
            "Do not merge, split, add, remove, or reorder blocks yet.",
            "Return strict JSON only: {\"blocks\":[{\"id\":\"block id\",\"text\":\"revised text\"}]}",
            "Include every input block id exactly once. If a block is already clear, return its original text.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ blocks }),
        },
      ],
      ...(includeReasoning ? { reasoning: { effort: "minimal" } } : {}),
    }),
  };
}

function parseModelOutput(output: string): ModelPolishResult {
  try {
    const parsed = JSON.parse(output) as { blocks?: Array<{ id?: unknown; text?: unknown }> };
    if (!Array.isArray(parsed.blocks)) {
      return { ok: false, reason: "OpenAI unavailable: invalid JSON shape" };
    }

    return {
      ok: true,
      items: parsed.blocks
        .filter((item): item is { id: string; text: string } => typeof item.id === "string" && typeof item.text === "string")
        .map((item) => ({ id: item.id, text: item.text })),
    };
  } catch {
    return { ok: false, reason: "OpenAI unavailable: invalid JSON" };
  }
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
