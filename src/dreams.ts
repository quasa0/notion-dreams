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

  const pages = await findChangedPages(notion, {
    ...(config.targetPageId ? { targetPageId: config.targetPageId } : {}),
    ...(config.targetDatabaseId ? { targetDatabaseId: config.targetDatabaseId } : {}),
    lastRunAt,
  });

  const changes: ChangeRecord[] = [];
  const skipped: SkippedRecord[] = [];
  let blocksReviewed = 0;

  for (const page of pages) {
    const blocks = await readEditableBlocks(notion, page);

    for (const block of blocks) {
      if (blocksReviewed >= config.maxBlocks) {
        skipped.push({ pageId: page.id, pageTitle: page.title, reason: "max block limit reached" });
        break;
      }

      blocksReviewed++;
      const polish = await polishBlock(block, config);

      if (!polish.changed) {
        skipped.push({
          pageId: page.id,
          pageTitle: page.title,
          blockId: block.id,
          reason: polish.skippedReason ?? "not changed",
        });
        continue;
      }

      if (!config.dryRun) {
        await updateBlockText(notion, block, polish.text);
      }

      changes.push({
        pageId: page.id,
        pageTitle: page.title,
        blockId: block.id,
        blockType: block.type,
        before: block.text,
        after: polish.text,
        reason: polish.reason,
        dryRun: config.dryRun,
      });
    }
  }

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
