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
  request_id?: string;
  ran_at?: string;
  blocks_changed?: number;
  blocks_reviewed?: number;
  pages_scanned?: number;
  status?: string;
  source?: string;
  error?: string;
};
