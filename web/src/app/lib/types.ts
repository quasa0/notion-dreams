export type DreamEdit = {
  id: string;
  page: string;
  path: string;
  block_type: string;
  before_text: string;
  after_text: string;
  edit_reason: string;
  status: "changed" | "skipped" | "archived";
  detected_at: string | null;
  run_id: string | null;
};

export type DreamRun = {
  key: string;
  run_id?: string;
  run_page_id?: string;
  report_page_id?: string;
  report_url?: string;
  public_report_url?: string;
  request_id?: string;
  ran_at?: string;
  blocks_changed?: number;
  blocks_reviewed?: number;
  chars_added?: number;
  chars_removed?: number;
  pages_scanned?: number;
  status?: string;
  source?: string;
  error?: string;
};

export type ReportRichText = {
  text: string;
  href?: string;
  bold?: boolean;
  strikethrough?: boolean;
  color?: string;
};

export type ReportBlock = {
  id: string;
  type: "paragraph" | "heading_2" | "numbered_list_item" | "quote";
  rich_text: ReportRichText[];
  children?: ReportBlock[];
};

export type ReportPreview =
  | { mode: "recordMap"; recordMap: unknown }
  | { mode: "blocks"; blocks: ReportBlock[] };
