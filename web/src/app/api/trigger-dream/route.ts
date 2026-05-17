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

export async function POST() {
  const requestStartedAt = new Date();
  try {
    const ntn = process.env.NTN_BIN || `${process.env.HOME}/.local/bin/ntn`;
    const { stdout, stderr } = await execFileAsync(ntn, ["workers", "sync", "trigger", "notionDreams"], {
      cwd: workerCwd,
      maxBuffer: 1024 * 1024 * 2,
      timeout: 1000 * 60 * 5,
    });
    const run = await waitForTriggeredRun(ntn, requestStartedAt);

    return NextResponse.json({
      ok: true,
      run,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger dream";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function waitForTriggeredRun(ntn: string, requestStartedAt: Date): Promise<WorkerRun | null> {
  const deadline = Date.now() + 1000 * 60 * 2;

  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync(ntn, ["workers", "runs", "list"], {
      cwd: workerCwd,
      maxBuffer: 1024 * 1024,
    });
    const run = parseRuns(stdout)
      .filter((item) => item.kind === "sync:notionDreams")
      .find((item) => new Date(item.startedAt).getTime() >= requestStartedAt.getTime() - 5000);

    if (run?.endedAt) return run;
    await sleep(1500);
  }

  return null;
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
      exitCode: exitCode === "-" ? "" : exitCode ?? "",
      startedAt: startedAt ?? "",
      endedAt: endedAt === "-" ? undefined : endedAt,
    }))
    .filter((run) => run.id && run.startedAt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
