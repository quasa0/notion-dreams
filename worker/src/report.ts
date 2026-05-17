import type { DreamsRunResult } from "./types.js";

export function reportTitle(date = new Date()): string {
  return `${date.toISOString().replace(/[:.]/g, "-")}-report`;
}

export function reportMarkdown(result: DreamsRunResult): string {
  const lines: string[] = [];

  lines.push(`# ${reportTitle(new Date(result.runStartedAt))}`);
  lines.push("");
  lines.push(`Run started: ${result.runStartedAt}`);
  lines.push(`Previous run cursor: ${result.lastRunAt}`);
  lines.push(`Next run cursor: ${result.nextLastRunAt}`);
  lines.push(`Pages scanned: ${result.pagesScanned}`);
  lines.push(`Blocks reviewed: ${result.blocksReviewed}`);
  lines.push(`Blocks changed: ${result.changes.length}`);
  lines.push(`Blocks skipped: ${result.skipped.length}`);
  lines.push("");

  lines.push("## Changes");
  lines.push("");
  if (result.changes.length === 0) {
    lines.push("No blocks changed.");
  }

  for (const [index, change] of result.changes.entries()) {
    lines.push(`### ${index + 1}. ${change.pageTitle}`);
    lines.push("");
    lines.push(`Page: ${change.pageId}`);
    lines.push(`Block: ${change.blockId}`);
    lines.push(`Type: ${change.blockType}`);
    lines.push(`Reason: ${change.reason}`);
    lines.push(`Dry run: ${change.dryRun ? "yes" : "no"}`);
    lines.push("");
    lines.push("Before:");
    lines.push("");
    lines.push(blockquote(change.before));
    lines.push("");
    lines.push("After:");
    lines.push("");
    lines.push(blockquote(change.after));
    lines.push("");
  }

  lines.push("## Skipped");
  lines.push("");
  if (result.skipped.length === 0) {
    lines.push("No skipped blocks.");
  }

  for (const skipped of result.skipped) {
    lines.push(
      `- ${skipped.pageTitle ?? "Unknown page"}${skipped.blockId ? ` / ${skipped.blockId}` : ""}: ${skipped.reason}`,
    );
  }

  return lines.join("\n");
}

function blockquote(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}
