import type { DreamsConfig } from "./config.js";
import { findChangedPages, readEditableBlocks, updateBlockText } from "./notion.js";
import { polishBlock } from "./polisher.js";
import type { ChangeRecord, DreamsRunResult, NotionClientLike, SkippedRecord } from "./types.js";

export async function runDreams(
  notion: NotionClientLike,
  config: DreamsConfig,
  state: { lastRunAt?: string } | undefined,
): Promise<DreamsRunResult> {
  const runStartedAt = new Date().toISOString();
  const lastRunAt =
    state?.lastRunAt ??
    new Date(Date.now() - config.initialLookbackHours * 60 * 60 * 1000).toISOString();

  logDream("start", `run_started=${runStartedAt}`);
  logDream("cursor", `cursor=${lastRunAt}`);
  logDream(
    "config",
    `config target_page=${config.targetPageId ?? "none"} target_database=${config.targetDatabaseId ?? "none"} dry_run=${config.dryRun} max_blocks=${config.maxBlocks}`,
  );

  const pages = await findChangedPages(notion, {
    ...(config.targetPageId ? { targetPageId: config.targetPageId } : {}),
    ...(config.targetDatabaseId ? { targetDatabaseId: config.targetDatabaseId } : {}),
    lastRunAt,
  });

  logDream("scan", `changed_pages=${pages.length}`);
  for (const page of pages) {
    logDream(
      "page",
      `page id=${page.id} title="${page.title}" last_edited=${page.lastEditedTime ?? "unknown"} url=${page.url ?? "none"}`,
    );
  }

  const changes: ChangeRecord[] = [];
  const skipped: SkippedRecord[] = [];
  let blocksReviewed = 0;

  for (const page of pages) {
    const blocks = await readEditableBlocks(notion, page);
    let pageChanged = 0;
    let pageSkipped = 0;

    logDream("scan", `page_scan title="${page.title}" editable_chunks=${blocks.length}`);

    for (const block of blocks) {
      if (blocksReviewed >= config.maxBlocks) {
        skipped.push({ pageId: page.id, pageTitle: page.title, reason: "max block limit reached" });
        logDream("skip", `skip page="${page.title}" reason="max block limit reached"`);
        break;
      }

      blocksReviewed++;
      logDream(
        "review",
        `review chunk=${blocksReviewed} page="${page.title}" block=${block.id} type=${block.type} chars=${block.text.length}`,
      );
      const polish = await polishBlock(block, config);

      if (!polish.changed) {
        pageSkipped++;
        skipped.push({
          pageId: page.id,
          pageTitle: page.title,
          blockId: block.id,
          reason: polish.skippedReason ?? "not changed",
        });
        logDream(
          "skip",
          `skip block=${block.id} page="${page.title}" reason="${polish.skippedReason ?? "not changed"}"`,
        );
        continue;
      }

      if (!config.dryRun) {
        await updateBlockText(notion, block, polish.text);
      }

      pageChanged++;
      logDream(
        "change",
        `change block=${block.id} page="${page.title}" reason="${polish.reason}" before_chars=${block.text.length} after_chars=${polish.text.length}`,
      );

      changes.push({
        pageId: page.id,
        pageTitle: page.title,
        ...(page.url ? { pageUrl: page.url } : {}),
        blockId: block.id,
        blockType: block.type,
        before: block.text,
        after: polish.text,
        reason: polish.reason,
        dryRun: config.dryRun,
      });
    }

    logDream("done", `page_done title="${page.title}" changed=${pageChanged} skipped=${pageSkipped}`);
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
