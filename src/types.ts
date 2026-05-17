export type NotionClientLike = {
  search(args: Record<string, unknown>): Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>;
  databases?: {
    query(args: Record<string, unknown>): Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>;
  };
  dataSources?: {
    query(args: Record<string, unknown>): Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>;
  };
  pages: {
    retrieve(args: { page_id: string }): Promise<unknown>;
  };
  blocks: {
    children: {
      list(args: Record<string, unknown>): Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>;
    };
    update(args: Record<string, unknown>): Promise<unknown>;
  };
};

export type PageCandidate = {
  id: string;
  title: string;
  url?: string;
  lastEditedTime?: string;
};

export type EditableBlock = {
  id: string;
  type: EditableBlockType;
  pageId: string;
  pageTitle: string;
  text: string;
};

export type EditableBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "quote"
  | "callout";

export type ChangeRecord = {
  pageId: string;
  pageTitle: string;
  blockId: string;
  blockType: string;
  before: string;
  after: string;
  reason: string;
  dryRun: boolean;
};

export type SkippedRecord = {
  pageId?: string;
  pageTitle?: string;
  blockId?: string;
  reason: string;
};

export type DreamsRunResult = {
  runStartedAt: string;
  lastRunAt: string;
  nextLastRunAt: string;
  pagesScanned: number;
  blocksReviewed: number;
  changes: ChangeRecord[];
  skipped: SkippedRecord[];
};
