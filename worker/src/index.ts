import { Client } from "@notionhq/client";
import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";
import { loadConfig } from "./config.js";
import { diffDisplayParts, diffStats } from "./diff.js";
import { runDreams } from "./dreams.js";
import type { ChangeRecord, DreamsRunProgress, DreamsRunResult, NotionClientLike } from "./types.js";

const worker = new Worker();
export default worker;

const notionDreamsSchedule = "1h";

const reports = worker.database("dreamsReports", {
  type: "managed",
  initialTitle: "dreams-db",
  primaryKeyProperty: "Report ID",
  schema: {
    properties: {
      Name: Schema.title(),
      "Report ID": Schema.richText(),
      Status: Schema.richText(),
      "Run Started At": Schema.richText(),
      "Pages Scanned": Schema.number(),
      "Blocks Reviewed": Schema.number(),
      "Blocks Changed": Schema.number(),
      "Chars Added": Schema.number(),
      "Chars Removed": Schema.number(),
      "Dry Run": Schema.checkbox(),
      "Report Page ID": Schema.richText(),
      "Report URL": Schema.url(),
      "Public Report URL": Schema.url(),
    },
  },
});

worker.sync("notionDreams", {
  database: reports,
  mode: "incremental",
  schedule: notionDreamsSchedule,
  execute: async () => {
    const runStartedAt = new Date().toISOString();
    const reportId = reportTitle(runStartedAt);
    let notion: Client | undefined;
    let config: ReturnType<typeof loadConfig> | undefined;
    let liveReport: LiveReport | undefined;
    let runRow: { id: string; progressBlockId?: string } | undefined;

    try {
      const auth = process.env.DREAMS_NOTION_API_TOKEN ?? process.env.NOTION_API_TOKEN;
      const reportDataSourceId = process.env.DREAMS_REPORT_DATA_SOURCE_ID;
      const reportsPageId = process.env.DREAMS_REPORTS_PAGE_ID;

      if (!auth) throw new Error("Set DREAMS_NOTION_API_TOKEN.");
      if (!reportDataSourceId) throw new Error("Set DREAMS_REPORT_DATA_SOURCE_ID.");
      if (!reportsPageId) throw new Error("Set DREAMS_REPORTS_PAGE_ID.");

      notion = new Client({ auth });
      config = loadConfig();
      liveReport = await createLiveReportPage(notion, reportsPageId, runStartedAt);
      runRow = await createRunRow(notion, reportDataSourceId, reportId, runStartedAt, config.dryRun, liveReport);
      const activeNotion = notion;
      const activeLiveReport = liveReport;
      const activeRunRow = runRow;
      const liveReportGroups = new Map<string, LiveReportPageGroup>();
      const lastRunAt = await latestRunStartedAt(activeNotion, reportDataSourceId, config.initialLookbackHours);
      const result = await runDreams(activeNotion as unknown as NotionClientLike, config, { lastRunAt, runStartedAt }, async (progress) => {
        await updateRunProgress(activeNotion, activeRunRow.progressBlockId, progress);
        if (progress.latestChange) {
          await appendReportChange(activeNotion, activeLiveReport.id, liveReportGroups, progress.latestChange);
          await updateReportSummary(activeNotion, activeLiveReport.summaryBlockId, progress, liveReportGroups.size);
        }
      });
      const stats = diffStats(result.changes);
      console.log(
        `[dreams-db] final upsert report_id="${reportId}" blocks_reviewed=${result.blocksReviewed} blocks_changed=${result.changes.length} chars_added=${stats.added} chars_removed=${stats.removed}`,
      );
      await updateReportSummary(notion, liveReport.summaryBlockId, result);
      await archiveRunRow(notion, runRow.id);

      console.log(
        `Notion Dreams run scanned ${result.pagesScanned} pages, reviewed ${result.blocksReviewed} blocks, changed ${result.changes.length} blocks.`,
      );

      return {
        changes: [
          {
            type: "upsert" as const,
            key: reportId,
            properties: {
              Name: Builder.title(reportId),
              "Report ID": Builder.richText(reportId),
              Status: Builder.richText("done"),
              "Run Started At": Builder.richText(result.runStartedAt),
              "Pages Scanned": Builder.number(result.pagesScanned),
              "Blocks Reviewed": Builder.number(result.blocksReviewed),
              "Blocks Changed": Builder.number(result.changes.length),
              "Chars Added": Builder.number(stats.added),
              "Chars Removed": Builder.number(stats.removed),
              "Dry Run": Builder.checkbox(config.dryRun),
              "Report Page ID": Builder.richText(liveReport.id),
              "Report URL": Builder.url(liveReport.url ?? ""),
              "Public Report URL": Builder.url(liveReport.publicUrl ?? ""),
            },
            pageContentMarkdown: [
              `# ${reportId}`,
              "",
              `Run started: ${result.runStartedAt}`,
              `Previous run cursor: ${result.lastRunAt}`,
              `Pages scanned: ${result.pagesScanned}`,
              `Blocks reviewed: ${result.blocksReviewed}`,
              `Blocks changed: ${result.changes.length}`,
              `Dry run: ${config.dryRun ? "yes" : "no"}`,
              "",
              liveReport.url ? `Report page: ${liveReport.url}` : "Report page created.",
            ].join("\n"),
            targetDatabaseKey: "dreamsReports",
          },
        ],
        hasMore: false,
        nextState: { lastRunAt: result.nextLastRunAt },
      };
    } catch (error) {
      console.error(error);
      if (notion && liveReport) {
        await appendReportFailed(notion, liveReport.id, error);
      }
      if (notion && runRow) {
        await archiveRunRow(notion, runRow.id);
      }
      return failedRunResponse({
        reportId,
        runStartedAt,
        dryRun: config?.dryRun ?? false,
        ...(liveReport ? { liveReport } : {}),
        error,
      });
    }
  },
});

function failedRunResponse(args: {
  reportId: string;
  runStartedAt: string;
  dryRun: boolean;
  liveReport?: LiveReport;
  error: unknown;
}) {
  const message = args.error instanceof Error ? args.error.message : "Unknown worker error";
  return {
        changes: [
          {
            type: "upsert" as const,
            key: args.reportId,
            properties: {
              Name: Builder.title(args.reportId),
              "Report ID": Builder.richText(args.reportId),
              Status: Builder.richText("failed"),
              "Run Started At": Builder.richText(args.runStartedAt),
              "Pages Scanned": Builder.number(0),
              "Blocks Reviewed": Builder.number(0),
              "Blocks Changed": Builder.number(0),
              "Chars Added": Builder.number(0),
              "Chars Removed": Builder.number(0),
              "Dry Run": Builder.checkbox(args.dryRun),
              "Report Page ID": Builder.richText(args.liveReport?.id ?? ""),
              "Report URL": Builder.url(args.liveReport?.url ?? ""),
              "Public Report URL": Builder.url(args.liveReport?.publicUrl ?? ""),
            },
            pageContentMarkdown: [`# ${args.reportId}`, "", "Run failed.", "", message].join("\n"),
            targetDatabaseKey: "dreamsReports",
          },
        ],
        hasMore: false,
        nextState: { lastRunAt: args.runStartedAt },
      };
}

async function latestRunStartedAt(
  notion: Client,
  dataSourceId: string,
  initialLookbackHours: number,
): Promise<string> {
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: 10,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });

  for (const latest of response.results) {
    if (!latest || !("properties" in latest)) continue;
    const status = richTextPropertyText(latest.properties.Status).toLowerCase();
    if (status === "in progress") continue;
    const value = richTextPropertyText(latest.properties["Run Started At"]);
    if (value) return value;
  }

  return new Date(Date.now() - initialLookbackHours * 60 * 60 * 1000).toISOString();
}

async function createRunRow(
  notion: Client,
  dataSourceId: string,
  reportId: string,
  runStartedAt: string,
  dryRun: boolean,
  report: LiveReport,
): Promise<{ id: string; progressBlockId?: string }> {
  const response = await notion.pages.create({
    parent: { data_source_id: dataSourceId },
    properties: {
      Name: titleProperty(reportId),
      "Report ID": richTextProperty(`${reportId} · in progress · ${runStartedAt}`),
      Status: richTextProperty("in progress"),
      "Run Started At": richTextProperty(runStartedAt),
      "Pages Scanned": { number: 0 },
      "Blocks Reviewed": { number: 0 },
      "Blocks Changed": { number: 0 },
      "Chars Added": { number: 0 },
      "Chars Removed": { number: 0 },
      "Dry Run": { checkbox: dryRun },
      "Report Page ID": richTextProperty(report.id),
      "Report URL": { url: report.url ?? null },
      "Public Report URL": { url: report.publicUrl ?? null },
    },
  } as never);

  const progress = await notion.blocks.children.append({
    block_id: response.id,
    children: [progressParagraph({ runStartedAt, pagesScanned: 0, blocksReviewed: 0, blocksChanged: 0, charsAdded: 0, charsRemoved: 0 })],
  } as never);
  const progressBlockId = (progress.results?.[0] as { id?: string } | undefined)?.id;
  console.log(
    `[dreams-db] create in-progress row id=${response.id} report_id="${reportId}" chars_added=0 chars_removed=0 progress_block=${progressBlockId ?? "none"}`,
  );

  return { id: response.id, ...(progressBlockId ? { progressBlockId } : {}) };
}

async function updateRunProgress(notion: Client, blockId: string | undefined, progress: DreamsRunProgress): Promise<void> {
  console.log(
    `[dreams-db] live progress requested progress_block=${blockId ?? "none"} run_started=${progress.runStartedAt} blocks_reviewed=${progress.blocksReviewed} blocks_changed=${progress.blocksChanged} chars_added=${progress.charsAdded} chars_removed=${progress.charsRemoved}`,
  );
  if (!blockId) return;
  try {
    await notion.blocks.update({
      block_id: blockId,
      paragraph: progressParagraph(progress).paragraph,
    } as never);
    console.log(
      `[dreams-db] live progress wrote progress_block=${blockId} run_started=${progress.runStartedAt} blocks_reviewed=${progress.blocksReviewed} blocks_changed=${progress.blocksChanged} chars_added=${progress.charsAdded} chars_removed=${progress.charsRemoved}`,
    );
  } catch (error) {
    console.warn("Failed to update live run progress", error);
  }
}

function progressParagraph(progress: DreamsRunProgress) {
  return paragraph(
    `__dreams_progress__ run_started=${progress.runStartedAt} pages_scanned=${progress.pagesScanned} blocks_reviewed=${progress.blocksReviewed} blocks_changed=${progress.blocksChanged} chars_added=${progress.charsAdded} chars_removed=${progress.charsRemoved}`,
  );
}

async function archiveRunRow(notion: Client, pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    in_trash: true,
  });
}

async function createReportPage(
  notion: Client,
  reportsPageId: string,
  result: DreamsRunResult,
): Promise<{ id: string; url?: string; publicUrl?: string }> {
  const title = reportTitle(result.runStartedAt);
  const children = reportBlocks(result);
  const response = await notion.pages.create({
    parent: { page_id: reportsPageId },
    properties: {
      title: titleProperty(title),
    },
    children,
  } as never);

  await notion.blocks.children.append({
    block_id: reportsPageId,
    position: { type: "start" },
    children: [reportLinkBlock(response.id, title)],
  } as never);

  const responseWithUrls = response as { id: string; url?: string; public_url?: string | null };
  const url = responseWithUrls.url ?? notionPageUrl(response.id, title);
  return {
    id: response.id,
    url,
    ...(responseWithUrls.public_url ? { publicUrl: responseWithUrls.public_url } : {}),
  };
}

async function createLiveReportPage(
  notion: Client,
  reportsPageId: string,
  runStartedAt: string,
): Promise<LiveReport> {
  const title = reportTitle(runStartedAt);
  const response = await notion.pages.create({
    parent: { page_id: reportsPageId },
    properties: {
      title: titleProperty(title),
    },
  } as never);

  const initialBlocks = await notion.blocks.children.append({
    block_id: response.id,
    children: [
      summaryParagraph(0, 0, 0, 0, runTriggerPhrase()),
      heading("Changes"),
    ],
  } as never);
  const summaryBlockId = (initialBlocks.results?.[0] as { id?: string } | undefined)?.id;

  await notion.blocks.children.append({
    block_id: reportsPageId,
    position: { type: "start" },
    children: [reportLinkBlock(response.id, title)],
  } as never);

  const responseWithUrls = response as { id: string; url?: string; public_url?: string | null };
  const url = responseWithUrls.url ?? notionPageUrl(response.id, title);
  return {
    id: response.id,
    url,
    ...(summaryBlockId ? { summaryBlockId } : {}),
    ...(responseWithUrls.public_url ? { publicUrl: responseWithUrls.public_url } : {}),
  };
}

async function appendReportChange(
  notion: Client,
  reportPageId: string,
  groups: Map<string, LiveReportPageGroup>,
  change: ChangeRecord,
): Promise<void> {
  const existing = groups.get(change.pageId);
  if (!existing) {
    const response = await notion.blocks.children.append({
      block_id: reportPageId,
      children: [liveChangeGroupBlock(change, 1)],
    } as never);
    const blockId = (response.results?.[0] as { id?: string } | undefined)?.id;
    if (blockId) {
      groups.set(change.pageId, {
        blockId,
        title: change.pageTitle,
        ...(change.pageUrl ? { url: change.pageUrl } : {}),
        count: 1,
      });
    }
    return;
  }

  existing.count++;
  await notion.blocks.update({
    block_id: existing.blockId,
    numbered_list_item: changeGroupListItem({
      title: existing.title,
      ...(existing.url ? { url: existing.url } : {}),
      changeCount: existing.count,
    }),
  } as never);
  await notion.blocks.children.append({
    block_id: existing.blockId,
    children: changeDetailBlocks(change, existing.count - 1),
  } as never);
}

async function updateReportSummary(
  notion: Client,
  blockId: string | undefined,
  progress: DreamsRunProgress | DreamsRunResult,
  changedPagesOverride?: number,
): Promise<void> {
  if (!blockId) return;
  const stats = "changes" in progress ? diffStats(progress.changes) : { added: progress.charsAdded, removed: progress.charsRemoved };
  const changedBlocks = "changes" in progress ? progress.changes.length : progress.blocksChanged;
  const changedPages = changedPagesOverride ?? ("changes" in progress ? groupChangesByPage(progress.changes).length : 0);
  await notion.blocks.update({
    block_id: blockId,
    paragraph: summaryParagraph(
      changedBlocks,
      changedPages ?? 0,
      stats.added,
      stats.removed,
      runTriggerPhrase(),
    ).paragraph,
  } as never);
}

async function appendReportFailed(notion: Client, reportPageId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  await notion.blocks.children.append({
    block_id: reportPageId,
    children: [
      paragraphRich([
        richText("Run failed", { bold: true, color: "red" }),
        richText(` · ${message}`),
      ]),
    ],
  } as never);
}

function notionPageUrl(pageId: string, title: string): string {
  const slug = title
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `https://www.notion.so/${slug}-${pageId.replace(/-/g, "")}`;
}

function reportTitle(runStartedAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: process.env.DREAMS_REPORT_TIME_ZONE || "America/Los_Angeles",
  })
    .format(new Date(runStartedAt))
    .replace(" at 24:", " at 00:");
}

function titleProperty(content: string) {
  return { title: [richText(content)] };
}

function richTextProperty(content: string) {
  return { rich_text: content ? [richText(content)] : [] };
}

function reportLinkBlock(pageId: string, title: string) {
  return {
    object: "block",
    type: "link_to_page",
    link_to_page: { type: "page_id", page_id: pageId },
  };
}

function richTextPropertyText(property: unknown): string {
  const prop = property as { type?: string; rich_text?: Array<{ plain_text?: string }> };
  if (prop?.type !== "rich_text") return "";
  return prop.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
}

function reportBlocks(result: DreamsRunResult): Record<string, unknown>[] {
  const grouped = groupChangesByPage(result.changes);
  const stats = diffStats(result.changes);
  const blocks: Record<string, unknown>[] = [
    summaryParagraph(result.changes.length, grouped.length, stats.added, stats.removed, runTriggerPhrase()),
  ];

  if (result.changes.length === 0) {
    blocks.push(heading("Changes"), paragraph("No chunks changed."));
    return blocks;
  }

  blocks.push(heading("Changes"));

  for (const group of grouped) {
    blocks.push(changeGroupBlock(group));
  }

  blocks.push(paragraph(""), paragraph(""));

  return blocks.slice(0, 100);
}

function groupChangesByPage(changes: ChangeRecord[]) {
  const groups = new Map<string, { title: string; url?: string; changes: ChangeRecord[] }>();

  for (const change of changes) {
    const existing = groups.get(change.pageId);
    if (existing) {
      existing.changes.push(change);
      continue;
    }

    groups.set(change.pageId, {
      title: change.pageTitle,
      ...(change.pageUrl ? { url: change.pageUrl } : {}),
      changes: [change],
    });
  }

  return [...groups.values()];
}

function runTriggerPhrase() {
  return "scheduled to run";
}

function summaryParagraph(changedBlocks: number, changedPages: number, added: number, removed: number, triggerPhrase: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        richText("notion-dreams", { bold: true }),
        richText(" was "),
        richText(triggerPhrase, { bold: true }),
        richText(" and updated "),
        richText(String(changedBlocks), { bold: true }),
        richText(" blocks across "),
        richText(String(changedPages), { bold: true }),
        richText(" pages: "),
        richText(`+${added}`, { color: "green" }),
        richText(" "),
        richText(`-${removed}`, { color: "red" }),
      ],
    },
  };
}

function changeGroupBlock(group: { title: string; url?: string; changes: ChangeRecord[] }) {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: changeGroupListItem({
      title: group.title,
      ...(group.url ? { url: group.url } : {}),
      changeCount: group.changes.length,
      children: group.changes.flatMap((change, index) => changeDetailBlocks(change, index)),
    }),
  };
}

function liveChangeGroupBlock(change: ChangeRecord, changeCount: number) {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: changeGroupListItem({
      title: change.pageTitle,
      ...(change.pageUrl ? { url: change.pageUrl } : {}),
      changeCount,
      children: changeDetailBlocks(change, changeCount - 1),
    }),
  };
}

function changeGroupListItem(group: {
  title: string;
  url?: string;
  changeCount: number;
  children?: Record<string, unknown>[];
}) {
  return {
    rich_text: [
      richText(group.title, group.url ? { link: group.url } : undefined),
      richText(` · ${group.changeCount} ${group.changeCount === 1 ? "change" : "changes"}`, { color: "gray" }),
    ],
    color: "default",
    ...(group.children ? { children: group.children } : {}),
  };
}

function changeDetailBlocks(change: ChangeRecord, index: number) {
  const reason = reportReason(change.reason);
  return [
    paragraphRich([
      richText(`Change ${index + 1}`, { bold: true, color: "gray" }),
      richText(` · ${change.blockType}`, { color: "gray" }),
      ...(reason ? [richText(` · ${reason}`, { color: "gray" })] : []),
    ]),
    diffQuote(change.before, change.after),
  ];
}

function reportReason(reason: string): string {
  const normalized = reason.trim();
  return normalized;
}

function diffQuote(before: string, after: string) {
  return {
    object: "block",
    type: "quote",
    quote: {
      rich_text: diffRichText(before, after),
      color: "default",
    },
  };
}

function diffRichText(before: string, after: string) {
  return diffDisplayParts(before, after)
    .filter((part) => part.text)
    .flatMap((part) => splitRichText(part.text, diffAnnotations(part.kind)));
}

function splitRichText(text: string, options: RichTextOptions = {}) {
  const chunks: ReturnType<typeof richText>[] = [];
  for (let index = 0; index < text.length; index += 1900) {
    chunks.push(richText(text.slice(index, index + 1900), options));
  }
  return chunks;
}

function diffAnnotations(kind: "same" | "removed" | "added"): RichTextOptions {
  if (kind === "removed") return { strikethrough: true, color: "red" };
  if (kind === "added") return { bold: true, color: "green" };
  return {};
}

type RichTextOptions = {
  bold?: boolean;
  strikethrough?: boolean;
  color?: string;
  link?: string;
};

type LiveReport = {
  id: string;
  url?: string;
  publicUrl?: string;
  summaryBlockId?: string;
};

type LiveReportPageGroup = {
  blockId: string;
  title: string;
  url?: string;
  count: number;
};

function richText(content: string, options: RichTextOptions = {}) {
  return {
    type: "text",
    text: { content, ...(options.link ? { link: { url: options.link } } : {}) },
    annotations: {
      bold: options.bold ?? false,
      italic: false,
      strikethrough: options.strikethrough ?? false,
      underline: false,
      code: false,
      color: options.color ?? "default",
    },
  };
}

function paragraph(content: string) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [richText(content)] } };
}

function paragraphRich(rich_text: ReturnType<typeof richText>[]) {
  return { object: "block", type: "paragraph", paragraph: { rich_text } };
}

function paragraphWithLink(label: string, url: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        richText(label),
        {
          ...richText(url),
          text: { content: url, link: { url } },
        },
      ],
    },
  };
}

function heading(content: string) {
  return { object: "block", type: "heading_2", heading_2: { rich_text: [richText(content)] } };
}
