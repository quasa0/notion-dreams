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

type ChunkedPolishResult = {
  ok: boolean;
  items: Array<{ id: string; text: string }>;
  reason: string;
};

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

  const llmResults = await polishBlocksWithOpenAI(
    modelInputs.map((item) => ({ id: item.block.id, type: item.block.type, text: item.original })),
    config,
  );
  const byId = new Map<string, string>(llmResults.items.map((item) => [item.id, item.text]));

  for (const item of modelInputs) {
    const heuristic = heuristicPolish(item.original);
    const polished = (byId.get(item.block.id) || heuristic).trim();

    if (!polished || polished === item.original) {
      results[item.index] = skip(llmResults.ok ? "already clear" : `${llmResults.reason}; no local cleanup`);
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

async function polishBlocksWithOpenAI(
  blocks: Array<{ id: string; type: string; text: string }>,
  config: DreamsConfig,
): Promise<ChunkedPolishResult> {
  const items: Array<{ id: string; text: string }> = [];
  const failures: string[] = [];

  for (let index = 0; index < blocks.length; index += 8) {
    const chunk = blocks.slice(index, index + 8);
    const result = await polishPageWithOpenAI(chunk, config);
    if (result.ok) {
      items.push(...result.items);
    } else {
      failures.push(result.reason);
    }
  }

  return {
    ok: failures.length === 0,
    items,
    reason: failures[0] ?? "OpenAI unavailable",
  };
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
  if (!apiKey) {
    logOpenAI(`skip reason="missing API key" blocks=${blocks.length}`);
    return { ok: false, reason: "OpenAI unavailable: missing API key" };
  }

  try {
    let response = await openAIAttempt(apiKey, config, blocks, true, 1);

    if (response.status === 400) {
      logOpenAI(`retry reason="HTTP 400 with reasoning" next_attempt=2 blocks=${blocks.length}`);
      response = await openAIAttempt(apiKey, config, blocks, false, 2);
    }

    if (!response.ok) {
      logOpenAI(`fail status=${response.status} blocks=${blocks.length}`);
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
    if (!output) {
      logOpenAI(`fail reason="empty response" blocks=${blocks.length}`);
      return { ok: false, reason: "OpenAI unavailable: empty response" };
    }

    const parsed = parseModelOutput(output);
    logOpenAI(parsed.ok ? `ok parsed_blocks=${parsed.items.length} input_blocks=${blocks.length}` : `fail reason="${parsed.reason}" blocks=${blocks.length}`);
    return parsed;
  } catch (error) {
    logOpenAI(`fail reason="request failed" error="${error instanceof Error ? error.name : "unknown"}" blocks=${blocks.length}`);
    return { ok: false, reason: "OpenAI unavailable: request failed" };
  }
}

async function openAIAttempt(
  apiKey: string,
  config: DreamsConfig,
  blocks: Array<{ id: string; type: string; text: string }>,
  includeReasoning: boolean,
  attempt: number,
): Promise<Response> {
  const started = Date.now();
  const chars = blocks.reduce((total, block) => total + block.text.length, 0);
  logOpenAI(`attempt=${attempt} model=${config.openaiModel} blocks=${blocks.length} chars=${chars} reasoning=${includeReasoning ? "on" : "off"}`);
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", responseRequest(apiKey, config, blocks, includeReasoning));
  logOpenAI(`attempt=${attempt} status=${response.status} elapsed_ms=${Date.now() - started}`);
  return response;
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
            "When adjacent sentences repeat the same point, replace them with one clear sentence that preserves the point.",
            "Fix obvious typos and duplicated filler words when the intended wording is clear.",
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

  const minimumRatio = hasSafeCompressionSignals(before) ? 0.25 : 0.45;
  if (after.length < before.length * minimumRatio) {
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

function hasSafeCompressionSignals(text: string): boolean {
  return hasRepeatedSentence(text) || /\b(?:really really|very very|basically basically|later later|right now right now|filler filler|not ready, not ready|clippp|recieve|teh|sucess)\b/i.test(text);
}

function hasRepeatedSentence(text: string): boolean {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((sentence) => sentence.length > 20);
  const seen = new Set<string>();
  for (const sentence of sentences) {
    if (seen.has(sentence)) return true;
    seen.add(sentence);
  }
  return false;
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

function logOpenAI(message: string) {
  console.log(`${formatLogTimestamp(new Date())} 🤖 [dreams] openai ${message}`);
}

function formatLogTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${value("day")}-${value("month")}-${value("year")} ${value("hour")}:${value("minute")}:${value("second")}.${ms}`;
}
