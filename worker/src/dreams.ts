import type { DreamsConfig } from "./config.js";
import { diffStats } from "./diff.js";
import { findChangedPages, readEditableBlocks, updateBlockText } from "./notion.js";
import { polishBlocks, type PolishResult } from "./polisher.js";
import type { ChangeRecord, DreamsRunProgress, DreamsRunResult, NotionClientLike, SkippedRecord } from "./types.js";

export async function runDreams(
  notion: NotionClientLike,
  config: DreamsConfig,
  state: { lastRunAt?: string; runStartedAt?: string } | undefined,
  onProgress?: (progress: DreamsRunProgress) => Promise<void>,
): Promise<DreamsRunResult> {
  const runStartedAt = state?.runStartedAt ?? new Date().toISOString();
  const lastRunAt =
    state?.lastRunAt ??
    new Date(Date.now() - config.initialLookbackHours * 60 * 60 * 1000).toISOString();
  const scanCursor = overlappedCursor(lastRunAt, config.scanOverlapMinutes);

  logDream("start", `run_started=${runStartedAt}`);
  logDream("cursor", `cursor=${lastRunAt} scan_cursor=${scanCursor}`);
  logDream(
    "config",
    `config target_page=${config.targetPageId ?? "none"} target_database=${config.targetDatabaseId ?? "none"} dry_run=${config.dryRun} max_blocks=${config.maxBlocks} scan_overlap_minutes=${config.scanOverlapMinutes}`,
  );

  const pages = sortPagesByRecency(await findChangedPages(notion, {
    ...(config.targetPageId ? { targetPageId: config.targetPageId } : {}),
    ...(config.targetDatabaseId ? { targetDatabaseId: config.targetDatabaseId } : {}),
    lastRunAt: scanCursor,
  }));

  logDream("scan", `changed_pages=${pages.length}`);
  for (const page of pages) {
    logDream(
      "page",
      `page id=${page.id} title="${page.title}" last_edited=${page.lastEditedTime ?? "unknown"} url=${page.url ?? "none"}`,
    );
  }

  const changes: ChangeRecord[] = [];
  const skipped: SkippedRecord[] = [];
  const pageWork: Array<{ page: (typeof pages)[number]; blocks: Awaited<ReturnType<typeof readEditableBlocks>>; nextIndex: number }> = [];
  let blocksReviewed = 0;
  let charsAdded = 0;
  let charsRemoved = 0;

  for (const page of pages) {
    const blocks = await readEditableBlocks(notion, page);

    logDream("scan", `page_scan title="${page.title}" editable_chunks=${blocks.length}`);

    const eligibleBlocks = [];
    for (const block of blocks) {
      if (block.text.trim().length < config.minTextLength) {
        skipped.push({
          pageId: page.id,
          pageTitle: page.title,
          blockId: block.id,
          reason: "too short to improve safely",
        });
        logDream("skip", `skip block=${block.id} page="${page.title}" reason="too short to improve safely"`);
      } else {
        eligibleBlocks.push(block);
      }
    }

    if (eligibleBlocks.length > 0) {
      pageWork.push({ page, blocks: sortBlocksByRecency(eligibleBlocks), nextIndex: 0 });
    }
  }

  for (const work of pageWork) {
    if (blocksReviewed >= config.maxBlocks) break;
    const remaining = config.maxBlocks - blocksReviewed;
    const selectedBlocks = work.blocks.slice(0, remaining);
    work.nextIndex = selectedBlocks.length;

    logDream("review", `review page_batch page="${work.page.title}" blocks=${selectedBlocks.length}`);
    const polishResults = await polishBlocks(selectedBlocks, config);

    for (const [index, block] of selectedBlocks.entries()) {
      const beforeChangeCount = changes.length;
      await reviewBlockResult({
        notion,
        config,
        page: work.page,
        block,
        polish: polishResults[index] ?? { text: "", reason: "", changed: false, skippedReason: "not changed" },
        changes,
        skipped,
        blocksReviewed: blocksReviewed + 1,
      });
      blocksReviewed++;
      if (changes.length !== beforeChangeCount) {
        const liveStats = diffStats(changes);
        charsAdded = liveStats.added;
        charsRemoved = liveStats.removed;
      }

      if (changes.length !== beforeChangeCount) {
        await onProgress?.({
          runStartedAt,
          pagesScanned: pages.length,
          blocksReviewed,
          blocksChanged: changes.length,
          charsAdded,
          charsRemoved,
        });
      }
    }
  }

  for (const work of pageWork) {
    if (work.nextIndex < work.blocks.length) {
      skipped.push({ pageId: work.page.id, pageTitle: work.page.title, reason: "max block limit reached" });
      logDream("skip", `skip page="${work.page.title}" reason="max block limit reached"`);
    }

    const pageChanged = changes.filter((change) => change.pageId === work.page.id).length;
    const pageSkipped = skipped.filter((skip) => skip.pageId === work.page.id).length;
    logDream("done", `page_done title="${work.page.title}" changed=${pageChanged} skipped=${pageSkipped}`);
  }

  for (const page of pages) {
    if (pageWork.some((work) => work.page.id === page.id)) continue;
    const pageSkipped = skipped.filter((skip) => skip.pageId === page.id).length;
    logDream("done", `page_done title="${page.title}" changed=0 skipped=${pageSkipped}`);
  }

  if (blocksReviewed >= config.maxBlocks) {
    logDream("skip", `skip reason="max block limit reached" reviewed=${blocksReviewed}`);
  }


  logDream(
    "done",
    `run_done pages=${pages.length} blocks_reviewed=${blocksReviewed} changed=${changes.length} skipped=${skipped.length}`,
  );

  return {
    runStartedAt,
    lastRunAt,
    nextLastRunAt: runStartedAt,
    pagesScanned: pages.length,
    blocksReviewed,
    changes,
    skipped,
  };
}

async function reviewBlockResult(args: {
  notion: NotionClientLike;
  config: DreamsConfig;
  page: Awaited<ReturnType<typeof findChangedPages>>[number];
  block: Awaited<ReturnType<typeof readEditableBlocks>>[number];
  polish: PolishResult;
  changes: ChangeRecord[];
  skipped: SkippedRecord[];
  blocksReviewed: number;
}): Promise<void> {
  const { notion, config, page, block, polish, changes, skipped, blocksReviewed } = args;
  logDream(
    "review",
    `review chunk=${blocksReviewed} page="${page.title}" block=${block.id} type=${block.type} chars=${block.text.length}`,
  );

  if (!polish.changed) {
    skipped.push({
      pageId: page.id,
      pageTitle: page.title,
      blockId: block.id,
      reason: polish.skippedReason ?? "not changed",
    });
    logDream("skip", `skip block=${block.id} page="${page.title}" reason="${polish.skippedReason ?? "not changed"}"`);
    return;
  }

  if (!config.dryRun) {
    await updateBlockText(notion, block, polish.text);
  }

  logDream(
    "change",
    `change block=${block.id} page="${page.title}" reason="${polish.reason}" before_chars=${block.text.length} after_chars=${polish.text.length}`,
  );

  const change = {
    pageId: page.id,
    pageTitle: page.title,
    ...(page.url ? { pageUrl: page.url } : {}),
    blockId: block.id,
    blockType: block.type,
    before: block.text,
    after: polish.text,
    reason: polish.reason,
    dryRun: config.dryRun,
  };

  changes.push(change);
}

function overlappedCursor(lastRunAt: string, overlapMinutes: number): string {
  const parsed = Date.parse(lastRunAt);
  if (!Number.isFinite(parsed)) return lastRunAt;
  return new Date(parsed - overlapMinutes * 60 * 1000).toISOString();
}

function sortBlocksByRecency<T extends { lastEditedTime?: string }>(blocks: T[]): T[] {
  return [...blocks].sort((a, b) => timestampMs(b.lastEditedTime) - timestampMs(a.lastEditedTime));
}

function sortPagesByRecency<T extends { lastEditedTime?: string }>(pages: T[]): T[] {
  return [...pages].sort((a, b) => timestampMs(b.lastEditedTime) - timestampMs(a.lastEditedTime));
}

function timestampMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type LogKind = "start" | "cursor" | "config" | "scan" | "page" | "review" | "skip" | "change" | "done";

const logEmoji: Record<LogKind, string> = {
  start: "🚀",
  cursor: "📍",
  config: "⚙️",
  scan: "🔎",
  page: "📄",
  review: "👀",
  skip: "⏭️",
  change: "✅",
  done: "🏁",
};

function logDream(kind: LogKind, message: string) {
  console.log(`${formatLogTimestamp(new Date())} ${logEmoji[kind]} [dreams] ${message}`);
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
