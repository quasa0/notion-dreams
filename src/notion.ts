import type { EditableBlock, EditableBlockType, NotionClientLike, PageCandidate } from "./types.js";

const editableBlockTypes = new Set<EditableBlockType>([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
]);

export async function findChangedPages(
  notion: NotionClientLike,
  opts: { targetPageId?: string; targetDatabaseId?: string; lastRunAt: string },
): Promise<PageCandidate[]> {
  if (opts.targetDatabaseId) {
    return queryChangedDataSourcePages(notion, opts.targetDatabaseId, opts.lastRunAt);
  }

  if (!opts.targetPageId) return [];
  const root = await notion.pages.retrieve({ page_id: opts.targetPageId });
  const pages = [pageFromObject(root)];
  const children = await findChildPages(notion, opts.targetPageId);
  pages.push(...children);

  return dedupePages(
    pages.filter((page) => !page.lastEditedTime || page.lastEditedTime > opts.lastRunAt),
  );
}

export async function readEditableBlocks(
  notion: NotionClientLike,
  page: PageCandidate,
): Promise<EditableBlock[]> {
  const blocks: EditableBlock[] = [];
  await collectEditableBlocks(notion, page.id, page.id, page.title, blocks);
  return blocks;
}

export async function updateBlockText(
  notion: NotionClientLike,
  block: EditableBlock,
  text: string,
): Promise<void> {
  await notion.blocks.update({
    block_id: block.id,
    [block.type]: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  });
}

async function queryChangedDataSourcePages(
  notion: NotionClientLike,
  dataSourceId: string,
  lastRunAt: string,
): Promise<PageCandidate[]> {
  const pages: PageCandidate[] = [];
  let cursor: string | undefined;
  const query = notion.dataSources?.query ?? notion.databases?.query;

  if (!query) {
    throw new Error("This Notion client does not expose dataSources.query or databases.query.");
  }

  do {
    const response = await query({
      data_source_id: dataSourceId,
      database_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        timestamp: "last_edited_time",
        last_edited_time: { after: lastRunAt },
      },
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    });

    pages.push(...response.results.map(pageFromObject));
    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return dedupePages(pages);
}

async function findChildPages(
  notion: NotionClientLike,
  rootBlockId: string,
): Promise<PageCandidate[]> {
  const childPages: PageCandidate[] = [];
  const blocks = await listAllBlockChildren(notion, rootBlockId);

  for (const block of blocks) {
    const obj = asRecord(block);
    if (obj.type === "child_page" && typeof obj.id === "string") {
      const page = await notion.pages.retrieve({ page_id: obj.id });
      childPages.push(pageFromObject(page));
      childPages.push(...(await findChildPages(notion, obj.id)));
    } else if (obj.has_children === true && typeof obj.id === "string") {
      childPages.push(...(await findChildPages(notion, obj.id)));
    }
  }

  return childPages;
}

async function collectEditableBlocks(
  notion: NotionClientLike,
  blockId: string,
  pageId: string,
  pageTitle: string,
  out: EditableBlock[],
): Promise<void> {
  const children = await listAllBlockChildren(notion, blockId);

  for (const child of children) {
    const obj = asRecord(child);
    const type = obj.type;

    if (typeof type === "string" && editableBlockTypes.has(type as EditableBlockType)) {
      const richText = asRecord(obj[type])["rich_text"];
      const text = plainText(richText);
      if (typeof obj.id === "string" && text.trim()) {
        out.push({
          id: obj.id,
          type: type as EditableBlockType,
          pageId,
          pageTitle,
          text,
        });
      }
    }

    if (obj.has_children === true && typeof obj.id === "string") {
      await collectEditableBlocks(notion, obj.id, pageId, pageTitle, out);
    }
  }
}

async function listAllBlockChildren(
  notion: NotionClientLike,
  blockId: string,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...response.results);
    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return results;
}

function pageFromObject(input: unknown): PageCandidate {
  const page = asRecord(input);
  return {
    id: String(page.id),
    title: pageTitle(page),
    ...(typeof page.url === "string" ? { url: page.url } : {}),
    ...(typeof page.last_edited_time === "string" ? { lastEditedTime: page.last_edited_time } : {}),
  };
}

function pageTitle(page: Record<string, unknown>): string {
  const properties = asRecord(page.properties);
  for (const value of Object.values(properties)) {
    const prop = asRecord(value);
    if (prop.type === "title") {
      const title = plainText(prop.title);
      if (title) return title;
    }
  }
  return "Untitled";
}

function plainText(richText: unknown): string {
  if (!Array.isArray(richText)) return "";
  return richText
    .map((part) => {
      const obj = asRecord(part);
      return typeof obj.plain_text === "string" ? obj.plain_text : "";
    })
    .join("");
}

function dedupePages(pages: PageCandidate[]): PageCandidate[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
