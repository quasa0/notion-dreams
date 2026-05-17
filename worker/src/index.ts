import { Client } from "@notionhq/client";
import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";
import { loadConfig } from "./config.js";
import { diffParts, diffStats } from "./diff.js";
import { runDreams } from "./dreams.js";
import type { ChangeRecord, DreamsRunProgress, DreamsRunResult, NotionClientLike } from "./types.js";

const worker = new Worker();
export default worker;

const notionDreamsSchedule = "manual";

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
    const auth = process.env.DREAMS_NOTION_API_TOKEN ?? process.env.NOTION_API_TOKEN;
    const reportDataSourceId = process.env.DREAMS_REPORT_DATA_SOURCE_ID;
    const reportsPageId = process.env.DREAMS_REPORTS_PAGE_ID;

    if (!auth) throw new Error("Set DREAMS_NOTION_API_TOKEN.");
    if (!reportDataSourceId) throw new Error("Set DREAMS_REPORT_DATA_SOURCE_ID.");
    if (!reportsPageId) throw new Error("Set DREAMS_REPORTS_PAGE_ID.");

    const notion = new Client({ auth });
    const config = loadConfig();
    const runStartedAt = new Date().toISOString();
    const reportId = reportTitle(runStartedAt);
    const runRow = await createRunRow(notion, reportDataSourceId, reportId, runStartedAt, config.dryRun);
    try {
      const lastRunAt = await latestRunStartedAt(notion, reportDataSourceId, config.initialLookbackHours);
      const result = await runDreams(notion as unknown as NotionClientLike, config, { lastRunAt, runStartedAt }, (progress) =>
        updateRunProgress(notion, runRow.progressBlockId, progress),
      );
      const stats = diffStats(result.changes);
      console.log(
        `[dreams-db] final upsert report_id="${reportId}" blocks_reviewed=${result.blocksReviewed} blocks_changed=${result.changes.length} chars_added=${stats.added} chars_removed=${stats.removed}`,
      );
      const report = await createReportPage(notion, reportsPageId, result);
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
              "Report Page ID": Builder.richText(report.id),
              "Report URL": Builder.url(report.url ?? ""),
              "Public Report URL": Builder.url(report.publicUrl ?? ""),
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
              report.url ? `Report page: ${report.url}` : "Report page created.",
            ].join("\n"),
            targetDatabaseKey: "dreamsReports",
          },
        ],
        hasMore: false,
        nextState: { lastRunAt: result.nextLastRunAt },
      };
    } catch (error) {
      console.error(error);
      await archiveRunRow(notion, runRow.id);
      return {
        changes: [
          {
            type: "upsert" as const,
            key: reportId,
            properties: {
              Name: Builder.title(reportId),
              "Report ID": Builder.richText(reportId),
              Status: Builder.richText("failed"),
              "Run Started At": Builder.richText(runStartedAt),
              "Pages Scanned": Builder.number(0),
              "Blocks Reviewed": Builder.number(0),
              "Blocks Changed": Builder.number(0),
              "Chars Added": Builder.number(0),
              "Chars Removed": Builder.number(0),
              "Dry Run": Builder.checkbox(config.dryRun),
              "Report Page ID": Builder.richText(""),
              "Report URL": Builder.url(""),
              "Public Report URL": Builder.url(""),
            },
            pageContentMarkdown: [`# ${reportId}`, "", "Run failed. See worker logs for details."].join("\n"),
            targetDatabaseKey: "dreamsReports",
          },
        ],
        hasMore: false,
        nextState: { lastRunAt: runStartedAt },
      };
    }
  },
});

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
      "Report Page ID": richTextProperty(""),
      "Report URL": { url: null },
      "Public Report URL": { url: null },
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
  return notionDreamsSchedule === "manual" ? "triggered manually" : "scheduled to run";
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
    numbered_list_item: {
      rich_text: [
        richText(group.title, group.url ? { link: group.url } : undefined),
        richText(" "),
      ],
      color: "default",
      children: group.changes.map((change) => diffQuote(change.before, change.after)),
    },
  };
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
  return diffParts(before, after)
    .filter((part) => part.text)
    .flatMap((part) => splitRichText(part.text, part.kind));
}

function splitRichText(text: string, kind: "same" | "removed" | "added" = "same") {
  const chunks: ReturnType<typeof richText>[] = [];
  for (let index = 0; index < text.length; index += 1900) {
    chunks.push(richText(text.slice(index, index + 1900), diffAnnotations(kind)));
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
