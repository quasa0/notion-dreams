export type DreamsConfig = {
  targetPageId?: string;
  targetDatabaseId?: string;
  dryRun: boolean;
  maxBlocks: number;
  minTextLength: number;
  initialLookbackHours: number;
  scanOverlapMinutes: number;
  openaiModel: string;
};

export function loadConfig(): DreamsConfig {
  const targetPageId = clean(process.env.DREAMS_TARGET_PAGE_ID);
  const targetDatabaseId = clean(process.env.DREAMS_TARGET_DATABASE_ID);

  if (!targetPageId && !targetDatabaseId) {
    throw new Error(
      "Set DREAMS_TARGET_PAGE_ID or DREAMS_TARGET_DATABASE_ID before running Notion Dreams.",
    );
  }

  return {
    ...(targetPageId ? { targetPageId } : {}),
    ...(targetDatabaseId ? { targetDatabaseId } : {}),
    dryRun: process.env.DREAMS_DRY_RUN === "true",
    maxBlocks: readInt("DREAMS_MAX_BLOCKS", 25),
    minTextLength: readInt("DREAMS_MIN_TEXT_LENGTH", 80),
    initialLookbackHours: readInt("DREAMS_INITIAL_LOOKBACK_HOURS", 24),
    scanOverlapMinutes: readInt("DREAMS_SCAN_OVERLAP_MINUTES", 10),
    openaiModel: process.env.DREAMS_OPENAI_MODEL || "gpt-4.1-mini",
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
