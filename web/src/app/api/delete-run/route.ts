import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

type DeleteMode = "report" | "run-and-report";

export async function POST(request: Request) {
  const auth = process.env.NOTION_API_TOKEN;
  if (!auth) {
    return NextResponse.json({ error: "Missing NOTION_API_TOKEN" }, { status: 500 });
  }

  const body = (await request.json()) as {
    mode?: DeleteMode;
    runPageId?: string;
    reportPageId?: string;
  };

  if (body.mode !== "report" && body.mode !== "run-and-report") {
    return NextResponse.json({ error: "Invalid delete mode" }, { status: 400 });
  }

  if (!body.reportPageId && body.mode === "report") {
    return NextResponse.json({ error: "Missing reportPageId" }, { status: 400 });
  }

  if (body.mode === "run-and-report" && !body.runPageId) {
    return NextResponse.json({ error: "Missing runPageId" }, { status: 400 });
  }

  const notion = new Client({ auth });

  try {
    if (body.reportPageId) {
      await notion.pages.update({ page_id: body.reportPageId, in_trash: true });
    }

    if (body.mode === "run-and-report" && body.runPageId) {
      await notion.pages.update({ page_id: body.runPageId, in_trash: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
