import { Client } from "@notionhq/client";
import type { DreamEdit, DreamRun } from "./types";
import { demoEdits, demoRuns } from "./demo";

type NotionPage = {
  id: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProperty>;
};

type NotionBlock = {
  type?: string;
  paragraph?: { rich_text?: RichText[] };
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

type DashboardCache = {
  expiresAt: number;
  data?: DreamDashboardData;
  pending?: Promise<DreamDashboardData>;
};

const dashboardCache: DashboardCache = { expiresAt: 0 };
const dashboardCacheMs = 1000;

export async function getDreamDashboardData(): Promise<DreamDashboardData> {
  const now = Date.now();
  if (dashboardCache.data && now < dashboardCache.expiresAt) {
    return dashboardCache.data;
  }

  if (dashboardCache.pending) {
    return dashboardCache.pending;
  }

  dashboardCache.pending = loadDreamDashboardData().then((data) => {
    dashboardCache.data = data;
    dashboardCache.expiresAt = Date.now() + dashboardCacheMs;
    dashboardCache.pending = undefined;
    return data;
  }, (error) => {
    dashboardCache.pending = undefined;
    throw error;
  });

  return dashboardCache.pending;
}

async function loadDreamDashboardData(): Promise<DreamDashboardData> {
  const auth = process.env.NOTION_API_TOKEN;
  const dataSourceId = process.env.NOTION_DREAMS_DATA_SOURCE_ID;

  if (!auth || !dataSourceId) {
    return { edits: demoEdits, runs: demoRuns, source: "demo" };
  }

  try {
    const notion = new Client({ auth });
    const response = await withTimeout(
      notion.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        sorts: [{ timestamp: "created_time", direction: "descending" }],
      }),
      3500,
      "Timed out loading Notion Dreams reports",
    );

    const runs = await Promise.all(response.results.map((page) => pageToRun(notion, page as NotionPage)));
    return { edits: runsToEdits(runs), runs, source: "notion" };
  } catch (error) {
    console.error("Failed to load Notion Dreams reports", error);
    return { edits: demoEdits, runs: demoRuns, source: "demo" };
  }
}

async function pageToRun(notion: Client, page: NotionPage): Promise<DreamRun> {
  const props = page.properties ?? {};
  const status = textProp(props.Status) || "unknown";
  const progress = status.toLowerCase() === "in progress" ? await readProgress(notion, page.id) : null;
  const reportId = status.toLowerCase() === "in progress"
    ? textProp(props.Name) || textProp(props["Report ID"]) || page.id
    : textProp(props["Report ID"]) || textProp(props.Name) || page.id;
  const ranAt = textProp(props["Run Started At"]) || page.created_time || page.last_edited_time;
  const changed = progress?.blocks_changed ?? numberProp(props["Blocks Changed"]);
  const reviewed = progress?.blocks_reviewed ?? numberProp(props["Blocks Reviewed"]);
  const added = progress?.chars_added ?? numberProp(props["Chars Added"]);
  const removed = progress?.chars_removed ?? numberProp(props["Chars Removed"]);
  const scanned = progress?.pages_scanned ?? numberProp(props["Pages Scanned"]);
  const reportPageId = textProp(props["Report Page ID"]);
  const reportUrl = urlProp(props["Report URL"]);
  const publicReportUrl = urlProp(props["Public Report URL"]);

  return {
    key: page.id,
    run_id: reportId,
    run_page_id: page.id,
    ...(reportPageId ? { report_page_id: reportPageId } : {}),
    ...(reportUrl ? { report_url: reportUrl } : {}),
    ...(publicReportUrl ? { public_report_url: publicReportUrl } : {}),
    ran_at: ranAt,
    blocks_changed: changed,
    blocks_reviewed: reviewed,
    chars_added: added,
    chars_removed: removed,
    pages_scanned: scanned,
    status,
    source: "worker",
  };
}

async function readProgress(notion: Client, pageId: string): Promise<Partial<DreamRun> | null> {
  try {
    const response = await withTimeout(
      notion.blocks.children.list({ block_id: pageId, page_size: 10 }),
      1500,
      "Timed out reading live run progress",
    );
    for (const block of response.results as NotionBlock[]) {
      if (block.type !== "paragraph") continue;
      const text = block.paragraph?.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
      const progress = parseProgress(text);
      if (progress) return progress;
    }
  } catch (error) {
    console.error("Failed to read live run progress", error);
  }

  return null;
}

function parseProgress(text: string): Partial<DreamRun> | null {
  if (!text.startsWith("__dreams_progress__ ")) return null;
  const values = new Map<string, string>();
  for (const part of text.slice("__dreams_progress__ ".length).split(/\s+/)) {
    const [key, value] = part.split("=");
    if (key && value) values.set(key, value);
  }

  return {
    pages_scanned: numberValue(values.get("pages_scanned")),
    blocks_reviewed: numberValue(values.get("blocks_reviewed")),
    blocks_changed: numberValue(values.get("blocks_changed")),
    chars_added: numberValue(values.get("chars_added")),
    chars_removed: numberValue(values.get("chars_removed")),
  };
}

function numberValue(value?: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function runsToEdits(runs: DreamRun[]): DreamEdit[] {
  const edits: DreamEdit[] = [];

  for (const run of runs) {
    if (run.status?.toLowerCase() === "in progress" || (run.blocks_changed ?? 0) !== 0) continue;
    edits.push({
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
    });
  }

  return edits;
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
