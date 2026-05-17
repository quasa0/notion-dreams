# Notion API Surface For Notion Goblin

This is the practical API surface exposed to a Notion Worker / Notion API connection for the Goblin project.

## Worker Runtime

Notion Workers are small Node/TypeScript programs hosted by Notion.

Relevant Worker capabilities:

- Syncs run on a schedule and can write results into Notion-managed databases.
- Webhooks receive HTTP events from external systems.
- Worker code can call the Notion API from inside capability handlers.

For this project, the main runtime should be a scheduled sync:

```ts
worker.sync("goblinCleanup", {
  schedule: "1d",
  execute: async (state, context) => {
    // scan, mutate, log
  },
});
```

Supported sync schedules include:

- `"5m"`
- `"15m"`
- `"1h"`
- `"1d"`
- `"manual"`

Minimum schedule is `"5m"`, maximum is `"7d"`.

The CLI can also trigger a sync manually for demos:

```bash
ntn workers sync trigger goblinCleanup
```

## Worker Notion Client

Worker capability handlers can use a Notion API client.

For syncs, webhooks, local testing, and CLI execution, we need to provide a token ourselves, usually via `NOTION_API_TOKEN`.

The client can read and write the same resources as the regular Notion API, subject to the connection token’s capabilities and content access.

## Content Access Model

The Worker can only access content shared with the connection/token.

Access options:

- Internal connection: pages/databases must be granted to the connection.
- Personal access token: uses the token creator’s Notion permissions.

For a hackathon demo, a personal access token or internal connection against a controlled demo workspace is simplest.

## Search / Discovery

Use search to find pages or data sources shared with the connection.

Useful for Goblin:

- Discover candidate pages.
- Sort by `last_edited_time`.
- Filter to pages only.
- Paginate through results.

Example shape:

```ts
await notion.search({
  query: "meeting notes",
  filter: {
    property: "object",
    value: "page",
  },
  sort: {
    direction: "descending",
    timestamp: "last_edited_time",
  },
});
```

Search response page objects can include:

- `id`
- `created_time`
- `last_edited_time`
- `created_by`
- `last_edited_by`
- `in_trash`
- `is_locked`
- `url`
- `public_url`
- `parent`
- `properties`
- `icon`
- `cover`

## Page Metadata

A page object can expose:

- `id`
- `created_time`
- `created_by`
- `last_edited_time`
- `last_edited_by`
- `in_trash`
- `is_locked`
- `url`
- `public_url`
- `parent`
- `properties`
- `icon`
- `cover`

Useful Goblin signals:

- `created_time`: old page detection.
- `last_edited_time`: stale page detection.
- `created_by`: owner/creator signal.
- `last_edited_by`: latest maintainer signal.
- `in_trash`: avoid processing trashed pages.
- `is_locked`: avoid or treat as higher-risk content.
- `parent`: understand location.
- `properties`: read status, owner, tags, priority, etc. when the page is in a data source.

Important limitation:

- The public page object does not expose `last_viewed_time`, viewers, view count, or reading duration.

## Page Updates

The API can update page metadata and page properties.

Useful Goblin actions:

- Update a page title.
- Update page properties if the page is in a data source.
- Set an icon/cover.
- Lock/unlock a page.
- Trash or restore a page.
- Apply templates.
- Erase page content when applying a template or clearing content.

For deletion behavior:

```ts
await notion.pages.update({
  page_id,
  in_trash: true,
});
```

Important limitation:

- The API supports trashing pages, not permanent deletion.
- In current API versions, use `in_trash`; older `archived` behavior is deprecated/removed.

## Blocks / Page Content

Page content is represented as blocks.

To read page content:

- Call retrieve block children with the page ID as `block_id`.
- Recursively fetch child blocks when `has_children` is true.

Block object metadata can include:

- `id`
- `type`
- `created_time`
- `created_by`
- `last_edited_time`
- `last_edited_by`
- `in_trash`
- `has_children`
- type-specific block data

Useful Goblin signals:

- Block text length.
- Repeated sections.
- Empty paragraphs.
- Old blocks.
- Recently edited blocks.
- Block creator / editor.
- Nested content volume.

Rich text blocks include `plain_text`, which is useful for analysis without formatting.

## Block Types

Common useful block types for Goblin:

- `paragraph`
- `heading_1`
- `heading_2`
- `heading_3`
- `heading_4`
- `bulleted_list_item`
- `numbered_list_item`
- `quote`
- `to_do`
- `toggle`
- `callout`
- `code`
- `table`
- `table_row`
- `child_page`
- `child_database`

Blocks that can have children include:

- Paragraph
- Toggle
- Callout
- Quote
- To do
- Bulleted list item
- Numbered list item
- Child page
- Child database
- Table
- Synced block
- Template
- Toggleable headings

Limitations:

- Some block types return as `unsupported`.
- Unsupported blocks expose the underlying block type name but not the full content.
- Some blocks, such as meeting notes, are read-only.
- Link preview blocks can be read but not created through the API.

## Block Updates

Useful Goblin actions:

- Update supported block rich text.
- Change block color for supported types.
- Append replacement blocks.
- Trash a block by setting `in_trash`.
- Restore a trashed block.

Possible rewrite approaches:

1. Update a verbose paragraph block in place.
2. Append a cleaned replacement block below the original.
3. Trash the original block after writing the replacement.
4. Add an audit entry with before/after text.

Append block children limitations:

- Appends new child blocks under a parent block/page/database.
- Cannot move existing blocks elsewhere.
- Can append up to 100 child blocks per request.
- Supports insertion at start, end, or after a specific block.

## Data Sources / Databases

Pages inside data sources have structured properties.

Useful Goblin signals from data source properties:

- Status
- Owner / people
- Date
- Tags / multi-select
- Created time
- Created by
- Last edited time
- Last edited by
- Checkbox
- URL
- Relations and rollups

Useful actions:

- Query a data source to scan known project/task/wiki databases.
- Update properties on pages inside a data source.
- Create a Goblin Report data source or page entries.
- Use formula/rollup values where available.

## Comments

The API can read and write comments if the connection has comment capabilities.

Useful Goblin actions:

- Add a comment explaining why content was rewritten or trashed.
- Leave a comment instead of rewriting when the page is locked/high-risk.
- Read existing comments as a signal that content may be active or important.

Limitations:

- Comment access requires explicit comment capabilities.
- Comments are not the same as page view analytics.

## Users

The API can expose user objects in places such as:

- `created_by`
- `last_edited_by`
- People properties
- Mentions

Useful Goblin signals:

- Who created a page/block.
- Who last edited a page/block.
- Whether a page has an owner property.

Limitations:

- User objects do not provide page read history.
- User objects do not provide dwell time or whether a user cares about a page.

## Webhooks

Workers can expose HTTP webhooks for external systems.

Useful future Goblin triggers:

- GitHub PR merged -> clean release notes or update project pages.
- External system event -> create/update Notion context.
- Manual external trigger -> run Goblin outside the schedule.

For current MVP, webhooks are optional. The scheduled sync is enough.

## View / Read Analytics

The Notion web UI shows page analytics in the side panel, including:

- View count over a selected time window
- Viewer list
- Recent viewer timestamps, if viewers allow view history
- Editor information such as created by and recently edited by

Official help docs confirm this product feature: page owners/editors can open `Updates & analytics` -> `Analytics` and see total views, unique views, and who created, edited, or viewed the page and when.

However, the supported public Notion API / Worker API does not expose these analytics fields:

- Last viewed time
- Who viewed a page
- View count
- Reading duration / dwell time
- Per-user read history

Evidence from docs/specs:

- Page analytics exists in the Notion UI.
- Workspace analytics exists, but Notion documents it as an Enterprise Plan feature.
- Workspace analytics can be exported to CSV from the UI, according to the help docs.
- The public `openapi.json` does not contain page analytics endpoints.
- The `openapi-undocumented.json` surface also does not expose a page analytics endpoint for Workers.
- The public API has a `Views` API, but that means database views/layouts/queries, not page view counts.

Notion does document audit/compliance events such as:

- Page viewed
- Page comments read
- Page exported
- File downloaded
- Page edited
- Page moved to Trash

But those compliance/audit features are documented as Enterprise features, available through admin/compliance surfaces, not as normal Business-trial Worker APIs.

Conclusion for Goblin:

- The UI has read analytics, but the supported Worker/API surface does not appear to expose them.
- Do not build the MVP around true read analytics unless we find a supported Worker-accessible endpoint.
- Use edit/content signals instead.
- If we want “unused” behavior, model it from stale edit time, low content value, missing owner, duplicate title, empty content, and stale status.
- Possible non-MVP investigation: inspect the Notion web app network calls to see whether analytics are fetched through private internal endpoints. Those should not be treated as stable or hackathon-safe unless Notion confirms they are supported for the developer platform.

Possible analytics workaround:

- If Enterprise workspace analytics CSV export is available, Goblin could ingest that exported CSV as an external data source.
- This would not be a pure Worker/API integration unless the export can be automated through a supported endpoint.
- For the hackathon Business trial, assume this is unavailable unless confirmed by Notion staff.

## Goblin Signals We Can Reliably Use

Good MVP signals:

- Page `last_edited_time`
- Page `created_time`
- Page `created_by`
- Page `last_edited_by`
- Page `in_trash`
- Page `is_locked`
- Page title
- Parent location
- Data source properties
- Block count
- Block types
- Block text length
- Block `last_edited_time`
- Block `created_time`
- Block `has_children`
- Empty / near-empty blocks
- Duplicate titles
- Repeated text
- Existing comments, if comment capabilities are enabled

Not reliable / not available for MVP:

- Last read
- Who read
- Time spent reading
- View count
- True popularity
- Organization-wide audit logs unless on Enterprise compliance features

## Practical MVP API Plan

1. Use `ntn workers new`.
2. Create a scheduled Worker sync with `schedule: "1d"`.
3. Provide `NOTION_API_TOKEN` to the Worker.
4. Use search or a configured root page/data source to find candidate pages.
5. Retrieve each page.
6. Recursively retrieve block children.
7. Score blocks/pages using content and edit metadata.
8. Rewrite verbose blocks.
9. Trash empty/stale/duplicate pages or blocks using `in_trash: true`.
10. Create a Goblin Report page or data source entry.
11. Trigger manually during the demo with `ntn workers sync trigger`.

## Sources

- Notion Workers overview: https://developers.notion.com/workers/get-started/overview
- Worker syncs and schedules: https://developers.notion.com/workers/guides/syncs
- Using the Notion API from a Worker: https://developers.notion.com/workers/guides/api-client
- API overview and content access: https://developers.notion.com/guides/get-started/overview
- Page object: https://developers.notion.com/reference/page
- Block object: https://developers.notion.com/reference/block
- Search API: https://developers.notion.com/reference/post-search
- Update page / trash page: https://developers.notion.com/reference/patch-page
- Append block children: https://developers.notion.com/reference/patch-block-children
- Comments API guide: https://developers.notion.com/guides/data-apis/working-with-comments
- Compliance/audit features: https://developers.notion.com/compliance/overview
- Audit log events: https://developers.notion.com/compliance/audit-log-events
