import { Client } from "@notionhq/client";
import type { DreamEdit, DreamRun } from "./types";
import { demoEdits, demoRuns } from "./demo";

type NotionPage = {
  id: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProperty>;
};

type NotionProperty = {
  type: string;
  title?: RichText[];
  rich_text?: RichText[];
  number?: number | null;
  checkbox?: boolean;
  url?: string | null;
};

type RichText = {
  plain_text?: string;
};

export type DreamDashboardData = {
  edits: DreamEdit[];
  runs: DreamRun[];
  source: "notion" | "demo";
};

export async function getDreamDashboardData(): Promise<DreamDashboardData> {
  const auth = process.env.NOTION_API_TOKEN;
  const dataSourceId = process.env.NOTION_DREAMS_DATA_SOURCE_ID;

  if (!auth || !dataSourceId) {
    return { edits: demoEdits, runs: demoRuns, source: "demo" };
  }

  try {
    const notion = new Client({ auth });
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 25,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    });

    const runs = response.results.map((page) => pageToRun(page as NotionPage));
    return { edits: runsToEdits(runs), runs, source: "notion" };
  } catch (error) {
    console.error("Failed to load Notion Dreams reports", error);
    return { edits: demoEdits, runs: demoRuns, source: "demo" };
  }
}

function pageToRun(page: NotionPage): DreamRun {
  const props = page.properties ?? {};
  const reportId = textProp(props["Report ID"]) || textProp(props.Name) || page.id;
  const ranAt = textProp(props["Run Started At"]) || page.created_time || page.last_edited_time;
  const status = textProp(props.Status) || "unknown";
  const changed = numberProp(props["Blocks Changed"]);
  const reviewed = numberProp(props["Blocks Reviewed"]);
  const scanned = numberProp(props["Pages Scanned"]);
  const reportPageId = textProp(props["Report Page ID"]);
  const reportUrl = urlProp(props["Report URL"]);

  return {
    key: page.id,
    run_id: reportId,
    run_page_id: page.id,
    ...(reportPageId ? { report_page_id: reportPageId } : {}),
    ...(reportUrl ? { report_url: reportUrl } : {}),
    ran_at: ranAt,
    blocks_changed: changed,
    blocks_reviewed: reviewed,
    pages_scanned: scanned,
    status,
    source: status.includes("hello") ? "manual-cli" : "worker",
  };
}

function runsToEdits(runs: DreamRun[]): DreamEdit[] {
  return runs
    .filter((run) => (run.blocks_changed ?? 0) === 0)
    .map((run) => ({
      id: `${run.key}-summary`,
      page: run.run_id ?? "Dreams report",
      path: "Dreams / report",
      block_type: "report",
      before_text: "No page text was changed by this run.",
      after_text: "This report came from the live Notion-managed Dreams data source.",
      edit_reason: `Status: ${run.status ?? "unknown"}. Pages scanned: ${run.pages_scanned ?? 0}. Blocks reviewed: ${run.blocks_reviewed ?? 0}.`,
      status: "skipped",
      detected_at: run.ran_at ?? null,
      run_id: run.run_id ?? null,
    }));
}

function textProp(prop?: NotionProperty): string {
  if (!prop) return "";
  const items = prop.type === "title" ? prop.title : prop.rich_text;
  return items?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
}

function numberProp(prop?: NotionProperty): number {
  return prop?.type === "number" && typeof prop.number === "number" ? prop.number : 0;
}

function urlProp(prop?: NotionProperty): string {
  return prop?.type === "url" && typeof prop.url === "string" ? prop.url : "";
}
