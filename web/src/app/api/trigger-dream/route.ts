import { NextResponse } from "next/server";

const workerId = "019e330e-f9a5-7a46-8b7b-a9c4a0711566";
const notionBaseUrl = process.env.NOTION_BASE_URL || "https://www.notion.so";

export async function POST() {
  try {
    const token = process.env.NOTION_API_TOKEN;
    if (!token) throw new Error("Cannot trigger dream because NOTION_API_TOKEN is not configured.");

    const response = await fetch(`${notionBaseUrl}/api/v3/workersSyncForceRun`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId, capabilityKey: "notionDreams" }),
      cache: "no-store",
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = typeof data?.message === "string" ? data.message : text;
      throw new Error(`Notion Workers API failed: ${response.status} ${message}`.trim());
    }

    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger dream";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
