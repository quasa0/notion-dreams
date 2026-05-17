import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const workerCwd = process.env.NOTION_WORKER_CWD || `${process.cwd().replace(/\/web$/, "")}/worker`;

type WorkerRun = {
  id: string;
  kind: string;
  exitCode: string;
  startedAt: string;
  endedAt?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as { ranAt?: string; workerRunId?: string };
  if (!body.ranAt && !body.workerRunId) {
    return NextResponse.json({ error: "Missing ranAt or workerRunId" }, { status: 400 });
  }

  try {
    const ntn = process.env.NTN_BIN || `${process.env.HOME}/.local/bin/ntn`;
    const { stdout } = await execFileAsync(ntn, ["workers", "runs", "list"], {
      cwd: workerCwd,
      maxBuffer: 1024 * 1024,
    });
    const runs = parseRuns(stdout).filter((run) => run.kind === "sync:notionDreams");
    const nearest = body.workerRunId
      ? runs.find((run) => run.id === body.workerRunId)
      : nearestRun(runs, body.ranAt ?? "");

    if (!nearest) {
      return NextResponse.json({ error: "No matching worker run found" }, { status: 404 });
    }

    const logs = await execFileAsync(ntn, ["workers", "runs", "logs", nearest.id], {
      cwd: workerCwd,
      maxBuffer: 1024 * 1024 * 2,
    });

    const cleanedLogs = cleanLogs(logs.stdout);
    return NextResponse.json({
      runId: nearest.id,
      startedAt: nearest.startedAt,
      endedAt: nearest.endedAt,
      exitCode: nearest.exitCode,
      hasTypeScriptLogs: cleanedLogs.includes("[dreams]"),
      logs: cleanedLogs || "No stdout logs were captured for this worker run.",
      rawLogs: logs.stdout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load worker logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function nearestRun(runs: WorkerRun[], ranAt: string): WorkerRun | undefined {
  const targetMs = new Date(ranAt).getTime();
  return runs
    .map((run) => ({ run, distance: Math.abs(new Date(run.startedAt).getTime() - targetMs) }))
    .sort((a, b) => a.distance - b.distance)[0]?.run;
}

function cleanLogs(logs: string): string {
  return logs
    .replace(/\n?<__notion_output__>[\s\S]*?<\/__notion_output__>\n?/g, "\n")
    .trim();
}

function parseRuns(output: string): WorkerRun[] {
  return output
    .trim()
    .split(/\n+/)
    .map((line) => line.split(/\t/))
    .filter((parts) => parts.length >= 4)
    .map(([id, kind, exitCode, startedAt, endedAt]) => ({
      id: id ?? "",
      kind: kind ?? "",
      exitCode: exitCode ?? "",
      startedAt: startedAt ?? "",
      endedAt,
    }))
    .filter((run) => run.id && run.startedAt);
}
