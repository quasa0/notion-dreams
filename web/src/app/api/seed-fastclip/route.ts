import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

type NotionBlock = Record<string, unknown>;

type GeneratedPage = {
  title: string;
  summary: string;
  sections: Array<{
    heading: string;
    paragraphs?: string[];
    bullets?: string[];
    todos?: Array<{ text: string; checked: boolean }>;
    quotes?: string[];
    table?: { headers: string[]; rows: string[][] };
  }>;
};

type GeneratedPayload = {
  pages: GeneratedPage[];
};

const legacyTitles = ["System Architecture", "Product Ops Runbook", "Customer Signal Log"];

export async function POST() {
  const notionToken = process.env.NOTION_API_TOKEN;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!notionToken) {
    return NextResponse.json({ error: "Missing NOTION_API_TOKEN" }, { status: 500 });
  }

  if (!openAiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const notion = new Client({ auth: notionToken });

  try {
    const teamDocs = await findOrCreateTeamDocs(notion);
    const existing = await findLegacyFastclipPages(notion);
    const moved = await moveExistingFastclipPages(notion, teamDocs.id, existing);
    const generated = await generateFastclipPages(openAiKey);
    const created = [];
    const usedTitles = new Map<string, number>();

    for (const page of generated.pages.slice(0, 3)) {
      const title = uniqueTitle(cleanGeneratedTitle(page.title), usedTitles);
      const response = await notion.pages.create({
        parent: { page_id: teamDocs.id },
        properties: {
          title: titleProperty(title),
        },
        children: pageToBlocks(page),
      } as never);

      created.push({
        id: response.id,
        title,
        url: "url" in response ? response.url : undefined,
      });
    }

    return NextResponse.json({ created, moved, parent: teamDocs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create Notion pages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function generateFastclipPages(openAiKey: string): Promise<GeneratedPayload> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0.95,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fastclip_company_docs",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["pages"],
            properties: {
              pages: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "summary", "sections"],
                  properties: {
                    title: { type: "string" },
                    summary: { type: "string" },
                    sections: {
                      type: "array",
                      minItems: 4,
                      maxItems: 7,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["heading", "paragraphs", "bullets", "todos", "quotes", "table"],
                        properties: {
                          heading: { type: "string" },
                          paragraphs: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 },
                          bullets: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
                          todos: {
                            type: "array",
                            minItems: 0,
                            maxItems: 5,
                            items: {
                              type: "object",
                              additionalProperties: false,
                              required: ["text", "checked"],
                              properties: {
                                text: { type: "string" },
                                checked: { type: "boolean" },
                              },
                            },
                          },
                          quotes: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 },
                          table: {
                            anyOf: [
                              { type: "null" },
                              {
                                type: "object",
                                additionalProperties: false,
                                required: ["headers", "rows"],
                                properties: {
                                  headers: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
                                  rows: {
                                    type: "array",
                                    minItems: 2,
                                    maxItems: 6,
                                    items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You generate realistic internal Notion documentation for a fictional company. Return only valid JSON that matches the provided schema. Do not mention that content is synthetic.",
        },
        {
          role: "user",
          content: fastclipPrompt(),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");

  const parsed = JSON.parse(content) as GeneratedPayload;
  validateGeneratedPayload(parsed);
  return parsed;
}

function fastclipPrompt() {
  return `
Generate 3 random, realistic internal company wiki pages for Team Docs at fastclip.it.

Company context:
- fastclip.it is an early-stage product that turns long calls, interviews, demos, and internal walkthrough recordings into short, reviewable clips.
- Users are founders, customer success teams, product marketers, PMs, and operators who record many calls but need the 30-90 second moments worth sharing.
- The product workflow: upload/import recording, transcribe, segment by speaker and timestamp, score candidate moments, draft clip titles and rationales, let humans approve/trim/export/share.
- Technical surface: Next.js web app, Notion Dreams dashboard, Notion API/Workers, background processing, transcript parsing, clip scoring, review state, audit trails, object storage, signed URLs, analytics.
- The team is small and practical. Pages should look like real working docs, not marketing copy.

Make these pages useful demo material for Notion Dreams:
- Include some normal clean documentation.
- Include several intentionally verbose paragraphs with filler words, hedging, repeated words, and sentences that can be tightened without changing meaning.
- Include at least one table across the 3 pages.
- Include todos, quotes, bullets, and operational details.
- Avoid top-level prefix in page titles. Titles should be only the topic, for example "Clip Review Quality Bar" or "Transcript Pipeline Notes".
- Do not reuse exactly these example titles: ${legacyTitles.join(", ")}.
- Do not use "fastclip.it -" in titles.
- Make the docs different every time. Random seed: ${Date.now()}-${Math.random()}.

Tone:
- Internal, specific, a little messy.
- Concrete enough that a worker can later polish wording and produce before/after diffs.
- No fake legal claims, no private personal data, no secrets.
`;
}

function validateGeneratedPayload(payload: GeneratedPayload) {
  if (!payload?.pages || payload.pages.length < 3) {
    throw new Error("OpenAI response did not include 3 pages");
  }

  for (const page of payload.pages) {
    if (!page.title || !page.summary || !Array.isArray(page.sections)) {
      throw new Error("OpenAI response page is missing title, summary, or sections");
    }
  }
}

async function findOrCreateTeamDocs(notion: Client): Promise<{ id: string }> {
  const configuredParentId = process.env.NOTION_DEMO_PARENT_PAGE_ID;
  if (configuredParentId) return { id: configuredParentId };

  const search = await notion.search({
    query: "Team Docs",
    filter: { property: "object", value: "page" },
    page_size: 10,
  });

  const existing = search.results.find((result) => {
    if (!("properties" in result)) return false;
    return getPageTitle(result.properties).trim().toLowerCase() === "team docs";
  });

  if (existing) return { id: existing.id };

  const response = await notion.pages.create({
    parent: { workspace: true },
    properties: {
      title: titleProperty("Team Docs"),
    },
    children: [
      h2("Demo Workspace"),
      p("Company docs used to demo Notion Dreams on realistic internal pages."),
    ],
  } as never);

  return { id: response.id };
}

async function findLegacyFastclipPages(notion: Client) {
  const results = await Promise.all(
    ["fastclip.it", ...legacyTitles].map((query) =>
      notion.search({
        query,
        filter: { property: "object", value: "page" },
        page_size: 50,
      })
    )
  );

  const titles = new Set(legacyTitles);
  const seen = new Set<string>();

  return results
    .flatMap((result) => result.results)
    .filter((result) => "properties" in result)
    .map((result) => ({ id: result.id, title: getPageTitle(result.properties) }))
    .filter((page) => titles.has(normalizedTitle(page.title)))
    .filter((page) => {
      if (seen.has(page.id)) return false;
      seen.add(page.id);
      return true;
    });
}

async function moveExistingFastclipPages(
  notion: Client,
  teamDocsPageId: string,
  pages: Array<{ id: string; title: string }>
) {
  const moved = await Promise.all(
    pages.map(async (page) => {
      const cleanTitle = normalizedTitle(page.title);
      if (page.title !== cleanTitle) {
        await notion.pages.update({
          page_id: page.id,
          properties: {
            title: titleProperty(cleanTitle),
          },
        } as never);
      }

      try {
        await notion.pages.move({
          page_id: page.id,
          parent: { page_id: teamDocsPageId },
        } as never);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("New parent must be different from the current parent")) {
          throw error;
        }
      }

      return { ...page, title: cleanTitle };
    })
  );

  return moved;
}

function pageToBlocks(page: GeneratedPage): NotionBlock[] {
  const blocks: NotionBlock[] = [p(page.summary)];

  for (const section of page.sections) {
    blocks.push(h2(section.heading));
    for (const paragraph of section.paragraphs ?? []) blocks.push(p(paragraph));
    for (const bullet of section.bullets ?? []) blocks.push(bulleted(bullet));
    for (const quoteText of section.quotes ?? []) blocks.push(quote(quoteText));
    if (section.table) blocks.push(table(section.table.headers, section.table.rows));
    for (const item of section.todos ?? []) blocks.push(todo(item.text, item.checked));
  }

  return blocks.slice(0, 90);
}

function cleanGeneratedTitle(title: string): string {
  return normalizedTitle(title).replace(/^team docs\s*\/\s*/i, "").trim().slice(0, 120) || "Untitled Team Doc";
}

function uniqueTitle(title: string, usedTitles: Map<string, number>): string {
  const count = usedTitles.get(title) ?? 0;
  usedTitles.set(title, count + 1);
  return count === 0 ? title : `${title} ${count + 1}`;
}

function normalizedTitle(title: string): string {
  return title.replace(/^fastclip\.it\s*-\s*/i, "").trim();
}

function titleProperty(content: string) {
  return { title: richText(content) };
}

function getPageTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (prop.type === "title") {
      return prop.title?.map((item) => item.plain_text ?? "").join("") ?? "";
    }
  }
  return "";
}

function richText(content: string) {
  return [{ type: "text", text: { content: content.slice(0, 1900) } }];
}

function p(content: string): NotionBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(content) } };
}

function h2(content: string): NotionBlock {
  return { object: "block", type: "heading_2", heading_2: { rich_text: richText(content) } };
}

function bulleted(content: string): NotionBlock {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(content) } };
}

function quote(content: string): NotionBlock {
  return { object: "block", type: "quote", quote: { rich_text: richText(content) } };
}

function todo(content: string, checked: boolean): NotionBlock {
  return { object: "block", type: "to_do", to_do: { rich_text: richText(content), checked } };
}

function table(headers: string[], rows: string[][]): NotionBlock {
  const normalizedRows = rows.map((row) => headers.map((_, index) => row[index] ?? ""));

  return {
    object: "block",
    type: "table",
    table: {
      table_width: headers.length,
      has_column_header: true,
      has_row_header: false,
      children: [headers, ...normalizedRows].map((row) => ({
        object: "block",
        type: "table_row",
        table_row: {
          cells: row.map((cell) => richText(cell)),
        },
      })),
    },
  };
}
