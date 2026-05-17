import { Client } from "@notionhq/client";
import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";
import { loadConfig } from "./config.js";
import { runDreams } from "./dreams.js";
import type { ChangeRecord, DreamsRunResult, NotionClientLike } from "./types.js";

const worker = new Worker();
export default worker;

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
      "Dry Run": Schema.checkbox(),
      "Report Page ID": Schema.richText(),
      "Report URL": Schema.url(),
    },
  },
});

worker.sync("notionDreams", {
  database: reports,
  mode: "incremental",
  schedule: "manual",
  execute: async () => {
    const auth = process.env.DREAMS_NOTION_API_TOKEN ?? process.env.NOTION_API_TOKEN;
    const reportDataSourceId = process.env.DREAMS_REPORT_DATA_SOURCE_ID;
    const reportsPageId = process.env.DREAMS_REPORTS_PAGE_ID;

    if (!auth) throw new Error("Set DREAMS_NOTION_API_TOKEN.");
    if (!reportDataSourceId) throw new Error("Set DREAMS_REPORT_DATA_SOURCE_ID.");
    if (!reportsPageId) throw new Error("Set DREAMS_REPORTS_PAGE_ID.");

    const notion = new Client({ auth });
    const config = loadConfig();
    const lastRunAt = await latestRunStartedAt(notion, reportDataSourceId, config.initialLookbackHours);
    const result = await runDreams(notion as unknown as NotionClientLike, config, { lastRunAt });
    const report = await createReportPage(notion, reportsPageId, result);
    const reportId = reportTitle(result.runStartedAt);

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
            Status: Builder.richText(result.changes.length > 0 ? "changed" : "no changes"),
            "Run Started At": Builder.richText(result.runStartedAt),
            "Pages Scanned": Builder.number(result.pagesScanned),
            "Blocks Reviewed": Builder.number(result.blocksReviewed),
            "Blocks Changed": Builder.number(result.changes.length),
            "Dry Run": Builder.checkbox(config.dryRun),
            "Report Page ID": Builder.richText(report.id),
            "Report URL": Builder.url(report.url ?? ""),
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
  },
});

async function latestRunStartedAt(
  notion: Client,
  dataSourceId: string,
  initialLookbackHours: number,
): Promise<string> {
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: 1,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });

  const latest = response.results[0];
  if (latest && "properties" in latest) {
    const value = richTextPropertyText(latest.properties["Run Started At"]);
    if (value) return value;
  }

  return new Date(Date.now() - initialLookbackHours * 60 * 60 * 1000).toISOString();
}

async function createReportPage(
  notion: Client,
  reportsPageId: string,
  result: DreamsRunResult,
): Promise<{ id: string; url?: string }> {
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

  if ("url" in response && response.url) return { id: response.id, url: response.url };
  return { id: response.id, url: notionPageUrl(response.id, title) };
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
  const blocks: Record<string, unknown>[] = [
    heading("Run summary"),
    paragraph(`Previous run cursor: ${result.lastRunAt}`),
    paragraph(`Run started: ${result.runStartedAt}`),
    paragraph(
      `Scanned ${result.pagesScanned} pages, reviewed ${result.blocksReviewed} chunks, changed ${result.changes.length} chunks, skipped ${result.skipped.length}.`,
    ),
  ];

  if (result.changes.length === 0) {
    blocks.push(heading("Changes"), paragraph("No chunks changed."));
    return blocks;
  }

  blocks.push(heading("Changes"));
  const grouped = groupChangesByPage(result.changes);

  for (const group of grouped) {
    blocks.push(heading(group.title));
    if (group.url) blocks.push(paragraphWithLink("Page URL: ", group.url));

    for (const [index, change] of group.changes.entries()) {
      blocks.push(paragraph(`Chunk ${index + 1} · ${change.blockType} · ${change.reason}`));
      blocks.push(diffParagraph(change.before, change.after));
    }
  }

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

function diffParagraph(before: string, after: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: diffRichText(before, after),
    },
  };
}

function diffRichText(before: string, after: string) {
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  const rows = beforeTokens.length + 1;
  const cols = afterTokens.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = beforeTokens.length - 1; i >= 0; i--) {
    for (let j = afterTokens.length - 1; j >= 0; j--) {
      setCell(
        dp,
        i,
        j,
        tokenAt(beforeTokens, i) === tokenAt(afterTokens, j)
          ? cell(dp, i + 1, j + 1) + 1
          : Math.max(cell(dp, i + 1, j), cell(dp, i, j + 1)),
      );
    }
  }

  const parts: Array<{ kind: "same" | "removed" | "added"; text: string }> = [];
  let i = 0;
  let j = 0;

  while (i < beforeTokens.length && j < afterTokens.length) {
    if (tokenAt(beforeTokens, i) === tokenAt(afterTokens, j)) {
      pushPart(parts, "same", tokenAt(beforeTokens, i));
      i++;
      j++;
    } else if (cell(dp, i + 1, j) >= cell(dp, i, j + 1)) {
      pushPart(parts, "removed", tokenAt(beforeTokens, i));
      i++;
    } else {
      pushPart(parts, "added", tokenAt(afterTokens, j));
      j++;
    }
  }

  while (i < beforeTokens.length) pushPart(parts, "removed", tokenAt(beforeTokens, i++));
  while (j < afterTokens.length) pushPart(parts, "added", tokenAt(afterTokens, j++));

  return parts
    .filter((part) => part.text)
    .flatMap((part) => splitRichText(part.text, part.kind));
}

function tokenize(value: string): string[] {
  return value.match(/\s+|[^\s]+/g) ?? [];
}

function tokenAt(tokens: string[], index: number): string {
  return tokens[index] ?? "";
}

function cell(grid: number[][], row: number, col: number): number {
  return grid[row]?.[col] ?? 0;
}

function setCell(grid: number[][], row: number, col: number, value: number) {
  const target = grid[row];
  if (target) target[col] = value;
}

function pushPart(
  parts: Array<{ kind: "same" | "removed" | "added"; text: string }>,
  kind: "same" | "removed" | "added",
  text: string,
) {
  const previous = parts.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
  } else {
    parts.push({ kind, text });
  }
}

function splitRichText(text: string, kind: "same" | "removed" | "added") {
  const chunks: ReturnType<typeof richText>[] = [];
  for (let index = 0; index < text.length; index += 1900) {
    chunks.push(richText(text.slice(index, index + 1900), kind));
  }
  return chunks;
}

function richText(content: string, kind: "same" | "removed" | "added" = "same") {
  return {
    type: "text",
    text: { content },
    annotations: {
      bold: kind === "added",
      italic: false,
      strikethrough: kind === "removed",
      underline: false,
      code: false,
      color: kind === "removed" ? "red" : kind === "added" ? "green" : "default",
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
