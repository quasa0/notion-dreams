import { Client } from "@notionhq/client";
import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

const worker = new Worker();
export default worker;

const reports = worker.database("dreamsReports", {
  type: "managed",
  initialTitle: "Dreams",
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
    const runStartedAt = new Date().toISOString();
    const title = `${runStartedAt.replace(/[:.]/g, "-")}-hello-world`;
    const report = await createMockReportPage(title, runStartedAt);

    console.log(`Notion Dreams hello world run started at ${runStartedAt}`);

    return {
      changes: [
        {
          type: "upsert" as const,
          key: title,
          properties: {
            Name: Builder.title(title),
            "Report ID": Builder.richText(title),
            Status: Builder.richText("hello world"),
            "Run Started At": Builder.richText(runStartedAt),
            "Pages Scanned": Builder.number(0),
            "Blocks Reviewed": Builder.number(0),
            "Blocks Changed": Builder.number(0),
            "Dry Run": Builder.checkbox(true),
            "Report Page ID": Builder.richText(report?.id ?? ""),
            "Report URL": Builder.url(report?.url ?? ""),
          },
          pageContentMarkdown: [
            `# ${title}`,
            "",
            "Hello from Notion Dreams.",
            "",
            `Run started: ${runStartedAt}`,
            "",
            report?.url ? `Summary report page: ${report.url}` : "Summary report page: not configured",
            "",
            "This temporary version exists so we can inspect Worker runs, sync status, logs, and report output before enabling page editing.",
          ].join("\n"),
        },
      ],
      hasMore: false,
      nextState: { lastRunAt: runStartedAt },
    };
  },
});

async function createMockReportPage(title: string, runStartedAt: string): Promise<{ id: string; url?: string } | undefined> {
  const auth = process.env.DREAMS_NOTION_API_TOKEN ?? process.env.NOTION_API_TOKEN;
  const parentPageId = process.env.DREAMS_REPORTS_PAGE_ID;

  if (!auth || !parentPageId) {
    console.log("Skipping mock report page creation; set DREAMS_NOTION_API_TOKEN and DREAMS_REPORTS_PAGE_ID.");
    return undefined;
  }

  const notion = new Client({ auth });
  const response = await notion.pages.create({
    parent: { page_id: parentPageId },
    properties: {
      title: richTextProperty(title),
    },
    children: [
      heading("Run Summary"),
      paragraph("Mock hello-world run for Notion Dreams. This page is the human-readable report artifact for the run."),
      paragraph(`Run started: ${runStartedAt}`),
      heading("Changes"),
      table(["Page", "Action", "Reason"], [["No source page", "No-op", "Hello-world run only verifies reporting plumbing."]]),
      heading("Next Step"),
      paragraph("Replace this mock report with real before/after edits once the polishing worker is enabled."),
    ],
  } as never);

  if ("url" in response && response.url) {
    return { id: response.id, url: response.url };
  }

  return { id: response.id };
}

function richText(content: string) {
  return [{ type: "text", text: { content } }];
}

function richTextProperty(content: string) {
  return { title: richText(content) };
}

function paragraph(content: string) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(content) } };
}

function heading(content: string) {
  return { object: "block", type: "heading_2", heading_2: { rich_text: richText(content) } };
}

function table(headers: string[], rows: string[][]) {
  return {
    object: "block",
    type: "table",
    table: {
      table_width: headers.length,
      has_column_header: true,
      has_row_header: false,
      children: [headers, ...rows].map((row) => ({
        object: "block",
        type: "table_row",
        table_row: {
          cells: row.map((cell) => richText(cell)),
        },
      })),
    },
  };
}
