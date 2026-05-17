import { NextResponse } from "next/server";

const workerId = "019e330e-f9a5-7a46-8b7b-a9c4a0711566";
const notionBaseUrl = process.env.NOTION_BASE_URL || "https://www.notion.so";

type WorkerRun = {
  runId: string;
  name: string;
  exitCode: number | string;
  startedAt: string;
  endedAt?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as { ranAt?: string; workerRunId?: string };
  if (!body.ranAt && !body.workerRunId) {
    return NextResponse.json({ error: "Missing ranAt or workerRunId" }, { status: 400 });
  }

  try {
    const runsResponse = await notionWorkerRequest<{ runs?: WorkerRun[] }>("workersListRunsForWorker", { workerId });
    const runs = (runsResponse.runs ?? []).filter((run) => run.name === "sync:notionDreams");
    const nearest = body.workerRunId
      ? runs.find((run) => run.runId === body.workerRunId)
      : nearestRun(runs, body.ranAt ?? "");

    if (!nearest) {
      return NextResponse.json({ error: "No matching worker run found" }, { status: 404 });
    }

    const logsResponse = await notionWorkerRequest<{ logs?: string }>("workersGetRunLogs", {
      workerId,
      runId: nearest.runId,
    });

    const rawLogs = logsResponse.logs ?? "";
    const cleanedLogs = cleanLogs(rawLogs);
    return NextResponse.json({
      runId: nearest.runId,
      startedAt: nearest.startedAt,
      endedAt: nearest.endedAt,
      exitCode: nearest.exitCode,
      hasTypeScriptLogs: cleanedLogs.includes("[dreams]"),
      logs: cleanedLogs || "No stdout logs were captured for this worker run.",
      rawLogs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load worker logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function notionWorkerRequest<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.NOTION_API_TOKEN;
  if (!token) throw new Error("Worker logs are unavailable because NOTION_API_TOKEN is not configured.");

  const response = await fetch(`${notionBaseUrl}/api/v3/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : text;
    throw new Error(`Notion Workers API failed: ${response.status} ${message}`.trim());
  }

  return data as T;
}

function nearestRun(runs: WorkerRun[], ranAt: string): WorkerRun | undefined {
  const targetMs = new Date(ranAt).getTime();
  let nearest: WorkerRun | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const run of runs) {
    const distance = Math.abs(new Date(run.startedAt).getTime() - targetMs);
    if (distance < nearestDistance) {
      nearest = run;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function cleanLogs(logs: string): string {
  return logs
    .replace(/\n?<__notion_output__>[\s\S]*?<\/__notion_output__>\n?/g, "\n")
    .trim();
}
