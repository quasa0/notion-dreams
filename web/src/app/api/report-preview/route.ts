import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";
import type { ReportBlock, ReportRichText } from "@/app/lib/types";

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  paragraph?: { rich_text?: NotionRichText[] };
  heading_2?: { rich_text?: NotionRichText[] };
  numbered_list_item?: { rich_text?: NotionRichText[]; color?: string };
  quote?: { rich_text?: NotionRichText[]; color?: string };
};

type NotionRichText = {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    strikethrough?: boolean;
    color?: string;
  };
};

export async function POST(request: Request) {
  const auth = process.env.NOTION_API_TOKEN;
  if (!auth) {
    return NextResponse.json({ error: "Missing NOTION_API_TOKEN" }, { status: 500 });
  }

  const body = (await request.json()) as { pageId?: string };
  if (!body.pageId) {
    return NextResponse.json({ error: "Missing pageId" }, { status: 400 });
  }

  try {
    const notion = new Client({ auth });
    const blocks = await withTimeout(readBlocks(notion, body.pageId, 0), 3500, "Timed out loading report preview");
    return NextResponse.json({ blocks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load report";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

async function readBlocks(notion: Client, blockId: string, depth: number): Promise<ReportBlock[]> {
  return readBlockPage(notion, blockId, depth);
}

async function readBlockPage(notion: Client, blockId: string, depth: number, cursor?: string): Promise<ReportBlock[]> {
  const response = await withTimeout(
    notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    }),
    2000,
    "Timed out reading report blocks",
  );

  const blocks = (
    await Promise.all(
      response.results.map(async (raw) => {
        const block = normalizeBlock(raw as NotionBlock);
        if (!block) return null;
        if ("has_children" in raw && raw.has_children && depth < 2) {
          block.children = await readBlocks(notion, raw.id, depth + 1);
        }
        return block;
      }),
    )
  ).filter((block): block is ReportBlock => Boolean(block));

  if (!response.next_cursor) return blocks;
  return [...blocks, ...(await readBlockPage(notion, blockId, depth, response.next_cursor))];
}

function normalizeBlock(block: NotionBlock): ReportBlock | null {
  if (
    block.type !== "paragraph" &&
    block.type !== "heading_2" &&
    block.type !== "numbered_list_item" &&
    block.type !== "quote"
  ) {
    return null;
  }

  const content = block[block.type] as { rich_text?: NotionRichText[]; color?: string } | undefined;

  return {
    id: block.id,
    type: block.type,
    rich_text: normalizeRichText(content?.rich_text ?? []),
    ...(content?.color ? { color: content.color } : {}),
  };
}

function normalizeRichText(items: NotionRichText[]): ReportRichText[] {
  return items.map((item) => ({
    text: item.plain_text ?? "",
    ...(item.href ? { href: item.href } : {}),
    ...(item.annotations?.bold ? { bold: true } : {}),
    ...(item.annotations?.strikethrough ? { strikethrough: true } : {}),
    ...(item.annotations?.color && item.annotations.color !== "default" ? { color: item.annotations.color } : {}),
  }));
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
