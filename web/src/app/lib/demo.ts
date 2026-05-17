import type { DreamEdit, DreamRun } from "./types";

export const demoRuns: DreamRun[] = [
  {
    key: "019e3318-6840",
    run_id: "019e3318-6840-7ba9-b46a-9898f25ff514",
    ran_at: "2026-05-16T23:21:40Z",
    blocks_changed: 2,
    status: "healthy",
    source: "manual-cli",
  },
  {
    key: "019e3318-5407",
    run_id: "019e3318-5407-7c74-8292-43aeb365471e",
    ran_at: "2026-05-16T23:21:32Z",
    blocks_changed: 0,
    status: "healthy",
    source: "scheduled",
  },
  {
    key: "019e3318-2a44",
    run_id: "019e3318-2a44-7643-ac2e-f666da4ce7fe",
    ran_at: "2026-05-16T23:21:22Z",
    blocks_changed: 0,
    status: "healthy",
    source: "deploy",
  },
];

export const demoEdits: DreamEdit[] = [
  {
    id: "launch-notes-1",
    page: "Launch Notes",
    path: "Dreams / 2026-05-16T23-21-40-report",
    block_type: "paragraph",
    before_text:
      "We basically need to make sure that the handoff is very clear so that everyone can really understand what is happening next.",
    after_text:
      "Make the handoff clear so everyone understands what happens next.",
    edit_reason: "Removed filler and tightened the sentence.",
    status: "changed",
    detected_at: "2026-05-16T23:21:40Z",
    run_id: "019e3318-6840",
  },
  {
    id: "product-sync-1",
    page: "Weekly Product Sync",
    path: "Dreams / 2026-05-16T23-21-40-report",
    block_type: "bulleted_list_item",
    before_text:
      "Actually, we should probably revisit onboarding soon because the current first-run flow is kind of confusing.",
    after_text:
      "Revisit onboarding soon; the current first-run flow is confusing.",
    edit_reason: "Kept the decision, removed hedging.",
    status: "changed",
    detected_at: "2026-05-16T23:21:40Z",
    run_id: "019e3318-6840",
  },
  {
    id: "api-plan-1",
    page: "API Plan",
    path: "Dreams / 2026-05-16T23-21-40-report",
    block_type: "code",
    before_text: "curl -fsSL https://ntn.dev | bash",
    after_text: "curl -fsSL https://ntn.dev | bash",
    edit_reason: "Skipped code block.",
    status: "skipped",
    detected_at: "2026-05-16T23:21:40Z",
    run_id: "019e3318-6840",
  },
];
