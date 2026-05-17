# AGENTS.md

## Project

This repo is the Notion Dreams hackathon project.

Notion Dreams is a Notion Worker plus a Next.js dashboard. The worker scans Notion pages changed since the previous run, lightly improves wording while preserving meaning and structure, writes a Dreams report page, and upserts a run row into a Notion-managed `dreams-db`. The dashboard reads `dreams-db` and lets the user inspect runs, reports, and TypeScript worker logs.

## User Preferences

- Move quickly and implement, do not over-plan.
- Keep answers short and concrete.
- Do not redeploy Vercel unless explicitly asked.
- It is okay to deploy only the Notion worker when worker code changes.
- The dashboard run list must show only rows from Notion `dreams-db`; do not merge raw `ntn workers runs` into the visible run history.
- Use Pacific time (`America/Los_Angeles`) across user-visible app UI and worker report names.
- Do not print secrets.
- Avoid changing unrelated files or reverting user changes.

## Repo Layout

- `worker/`: Notion Worker TypeScript app.
- `web/`: Next.js dashboard app.
- `hackathon.md`: cleaned hackathon info.
- `solution.md`: concise product/technical spec.
- `api.md`: relevant Notion API notes.

The worker was moved out of the repo root into `worker/` because root-level worker build output and dependencies appeared to interfere with `web` dev server behavior.

## Important Notion IDs

- Worker ID: `019e330e-f9a5-7a46-8b7b-a9c4a0711566`
- Top-level `notion-dreams` page: `363b1733-c74c-8167-afea-f7c7dcb70420`
- `dreams-reports` page: `363b1733-c74c-81c8-8fd7-c3fe0a4c651d`
- `dreams-db` database: `362b1733-c74c-81a0-82c4-ff9d28184fd6`
- `dreams-db` data source: `4d1c46de-cb92-4795-b6fe-27ef13a45491`
- `Team Docs` page scanned by worker: `363b1733-c74c-8187-9494-ee79e0a049e2`

## Secrets And Environment

Do not print or commit secret values.

Expected local env files:

- `web/.env.local`
- possibly `worker/.env`

Known env var names:

- `NOTION_API_TOKEN`
- `NOTION_DREAMS_DATA_SOURCE_ID`
- `OPENAI_API_KEY`
- `DREAMS_NOTION_API_TOKEN`
- `DREAMS_OPENAI_API_KEY`
- `DREAMS_TARGET_PAGE_ID`
- `DREAMS_REPORTS_PAGE_ID`
- `DREAMS_REPORT_DATA_SOURCE_ID`
- `DREAMS_DRY_RUN`
- `DREAMS_MAX_BLOCKS`
- `DREAMS_MIN_TEXT_LENGTH`
- `DREAMS_REPORT_TIME_ZONE`

Worker deployed env was configured to scan Team Docs and write to dreams-db/reports:

- `DREAMS_TARGET_PAGE_ID=363b1733-c74c-8187-9494-ee79e0a049e2`
- `DREAMS_REPORTS_PAGE_ID=363b1733-c74c-81c8-8fd7-c3fe0a4c651d`
- `DREAMS_REPORT_DATA_SOURCE_ID=4d1c46de-cb92-4795-b6fe-27ef13a45491`
- `DREAMS_DRY_RUN=false`
- `DREAMS_MAX_BLOCKS=40`
- `DREAMS_MIN_TEXT_LENGTH=60`
- `DREAMS_REPORT_TIME_ZONE=America/Los_Angeles`

## Commands

Worker:

```bash
cd worker
npm run check
npm run build
$HOME/.local/bin/ntn workers deploy --local-build
$HOME/.local/bin/ntn workers sync trigger notionDreams
$HOME/.local/bin/ntn workers runs list
$HOME/.local/bin/ntn workers runs logs <run_id>
```

Web:

```bash
cd web
npm run build
npm run dev -- --port 3000
```

Restart local web dev server:

```bash
pids=$(lsof -ti tcp:3000 || true)
if [ -n "$pids" ]; then printf '%s\n' "$pids" | xargs kill; fi
cd web
npm run dev -- --port 3000
```

## Current Behavior

Worker:

- Finds pages changed since `lastRunAt`.
- Reads editable text blocks.
- Sends eligible blocks to the OpenAI-backed polisher, falling back to local cleanup if needed.
- Updates changed blocks unless dry-run is enabled.
- Creates a human-readable report page.
- Upserts a row into `dreams-db`.
- Stores `lastRunAt` in worker context for the next run.

Worker console logs:

- Use Pacific human timestamps and status emoji.
- Example:

```text
16-05-2026 13:56:26.358 👀 [dreams] review chunk=...
16-05-2026 13:56:27.104 ⏭️ [dreams] skip block=...
16-05-2026 13:56:28.812 ✅ [dreams] change block=...
```

Dashboard:

- Reads run rows from `dreams-db`.
- Shows run history from `dreams-db` only.
- Clicking a run opens Overview.
- Clicking the row `Logs` button selects that run and immediately opens the TypeScript logs tab.
- Logs tab calls `/api/run-logs`, which shells out to `ntn workers runs logs` and matches by the selected dreams-db row timestamp.
- It strips the `<__notion_output__>...</__notion_output__>` platform envelope from displayed logs.
- It warns when older runs predate detailed `[dreams]` logs.
- Delete buttons can trash just the report page or both the report page and the run row.

## Design Decisions

- Use TypeScript for both worker and Next.js web UI.
- Do not use Notion page-view analytics because the public SDK/API does not expose page read/view duration data even though the Notion web UI shows analytics.
- Focus product behavior on wording cleanup for recently changed pages, not aggressive deletion.
- Preserve Notion page structure; only update text chunks.
- Reports should be human-readable, named like `May 16, 2026 at 17:54:52`, newest first where the API/UI allows it.
- Notion public API has limited support for reordering child pages in the sidebar. Do not spend time trying to perfectly reorder Notion sidebar child pages unless new API support is confirmed.

## Recent Git State

Remote:

- `origin` is `git@github.com:quasa0/notion-hack.git`
- Main branch has been pushed.

Recent commit:

- `8198d1a Separate worker app and improve run logs UI`

## Known Rough Edges / Next Work

- Improve the review page/report styling.
- Current report diff rendering is too word-level and hard to read.
- Desired diff direction: show larger changed text chunks, with removed text in red and replacement text in green side-by-side or as readable quoted blocks.
- Changed chunks should feel like quoted excerpts, not noisy per-word diffs.
- Keep the dashboard run list sourced only from `dreams-db`.
- Do not add raw worker run rows to visible run history.

## Verification Checklist

Before saying changes are done:

- Run `npm run build` in `web` for UI changes.
- Run `npm run check && npm run build` in `worker` for worker changes.
- If worker code changed and user expects deployed behavior, deploy from `worker/` with `ntn workers deploy --local-build`.
- If localhost behavior matters, restart `web` dev server and verify `http://localhost:3000`.

