import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";
import type { ReportBlock, ReportRichText } from "@/app/lib/types";

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  paragraph?: { rich_text?: NotionRichText[] };
  heading_2?: { rich_text?: NotionRichText[] };
  numbered_list_item?: { rich_text?: NotionRichText[] };
  quote?: { rich_text?: NotionRichText[] };
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
    const blocks = await readBlocks(notion, body.pageId, 0);
    return NextResponse.json({ blocks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function readBlocks(notion: Client, blockId: string, depth: number): Promise<ReportBlock[]> {
  const blocks: ReportBlock[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const raw of response.results) {
      const block = normalizeBlock(raw as NotionBlock);
      if (!block) continue;
      if (raw && "has_children" in raw && raw.has_children && depth < 2) {
        block.children = await readBlocks(notion, raw.id, depth + 1);
      }
      blocks.push(block);
    }

    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return blocks;
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

  return {
    id: block.id,
    type: block.type,
    rich_text: normalizeRichText(block[block.type]?.rich_text ?? []),
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
