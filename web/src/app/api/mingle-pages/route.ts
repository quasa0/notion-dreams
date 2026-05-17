import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

type NotionBlock = Record<string, unknown>;
type ChildPage = { id: string; title: string; url?: string };

const pacificStampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

const mingleSections = [
  {
    heading: "Review Handoff Notes",
    paragraphs: [
      "The review step is currently meant to be a lightweight confirmation moment, but in actual usage it has become a place where the team checks title quality, clip boundary confidence, transcript oddities, customer language, export readiness, and also whether the same clip was already mentioned somewhere else in the workspace, which means the reviewer is doing several overlapping jobs in one pass even when the page says this should be quick.",
      "We should keep the approval flow fast, but fast in this context means reviewers can still pause, compare, re-read, and sometimes go back to the transcript before approving, so the word fast should not be interpreted as always one click or always no review because quality still matters and the approval moment is also the quality moment.",
    ],
    bullets: [
      "Reviewer checks title clarity, transcript confidence, clip boundary shape, export readiness, and whether this same customer moment appears in another recap.",
      "Some of this repeats the quality bar, but it is included here too because people look at this page first during handoff.",
      "If the same issue appears in the transcript notes and the review notes, treat the transcript notes as the source of truth unless the review notes are more recent.",
    ],
  },
  {
    heading: "Pipeline Exception Handling",
    paragraphs: [
      "When uploads fail, the system should retry, but retrying can mean retrying the upload, retrying the transcript job, retrying the clip scoring step, or retrying the whole job from the beginning, and those options are similar but not identical because they each create different audit events and different partial states for operators to interpret later.",
      "The practical goal is that a customer success person can understand whether a recording is blocked, partially processed, mostly processed, waiting on a signed URL refresh, or already usable even though one optional enrichment step did not finish, which is a lot of statuses and some of them sound almost the same.",
    ],
    bullets: [
      "Do not mark an import complete just because a transcript exists; completion also depends on clip candidates and review state.",
      "If scoring fails after transcription succeeds, keep the transcript visible because that is still useful even if the candidate clips are not ready.",
      "This overlaps with the operations runbook status table, but keeping it here helps engineers see the same rule near the retry code.",
    ],
  },
  {
    heading: "Customer Language Cleanup",
    paragraphs: [
      "Customer quotes should preserve meaning and specific wording, but they often include filler, restarts, hedges, fragments, repeated phrases, and unclear references like this thing or that part, so the final clip rationale should be readable while still sounding like the customer actually said it and not like a polished marketing testimonial invented after the call.",
      "The clip title and the rationale are separate fields, although both summarize the same moment, and sometimes the rationale repeats the title because the reviewer needs context, but sometimes that repetition makes the export feel padded and less direct than it needs to be.",
    ],
    bullets: [
      "Keep product names, customer terms, numbers, timestamps, and named workflows unchanged.",
      "Reduce filler only after the meaning is obvious from the surrounding transcript.",
      "Avoid making the rationale sound more certain than the customer sounded in the recording.",
    ],
  },
];

export async function POST() {
  const notionToken = process.env.NOTION_API_TOKEN;

  console.log("[mingle-pages] request received");

  if (!notionToken) {
    console.log("[mingle-pages] missing NOTION_API_TOKEN");
    return NextResponse.json({ error: "Missing NOTION_API_TOKEN" }, { status: 500 });
  }

  const notion = new Client({ auth: notionToken });

  try {
    const teamDocs = await findTeamDocs(notion);
    console.log(`[mingle-pages] using Team Docs page ${teamDocs.id}`);

    const pages = await listChildPages(notion, teamDocs.id);
    console.log(`[mingle-pages] found ${pages.length} child pages`);

    if (pages.length < 1) {
      console.log("[mingle-pages] not enough pages to edit");
      return NextResponse.json({ error: "Need at least 1 page under Team Docs to mingle. Use Seed pages first." }, { status: 400 });
    }

    const maxPages = Math.min(pages.length, 5);
    const minPages = Math.min(pages.length, 2);
    const count = randomInt(minPages, maxPages);
    const selected = shuffle(pages).slice(0, count);
    const sections = shuffle(mingleSections);

    console.log(`[mingle-pages] randomly selected ${selected.length} pages`);

    const edited = await Promise.all(selected.map(async (page, index) => {
      console.log(`[mingle-pages] editing page ${page.id} title="${page.title}"`);

      await notion.blocks.children.append({
        block_id: page.id,
        children: sectionToBlocks(sections[index % sections.length], new Date()),
      } as never);

      return page;
    }));

    console.log(`[mingle-pages] edited ${edited.length} pages`);
    return NextResponse.json({ edited, parent: teamDocs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mingle Notion pages";
    console.error("[mingle-pages] failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function findTeamDocs(notion: Client): Promise<{ id: string }> {
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

  if (!existing) throw new Error("Could not find Team Docs. Use Seed pages first.");
  return { id: existing.id };
}

async function listChildPages(notion: Client, pageId: string, cursor?: string): Promise<ChildPage[]> {
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
    ...(cursor ? { start_cursor: cursor } : {}),
  });

  const pages: ChildPage[] = [];
  for (const block of response.results) {
    if ("type" in block && block.type === "child_page") {
      pages.push({
        id: block.id,
        title: block.child_page.title,
        url: notionPageUrl(block.id),
      });
    }
  }

  if (!response.next_cursor) return pages;
  return [...pages, ...(await listChildPages(notion, pageId, response.next_cursor))];
}

function notionPageUrl(id: string) {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sectionToBlocks(section: (typeof mingleSections)[number], now: Date): NotionBlock[] {
  const stamp = pacificStampFormatter.format(now);

  return [
    h2(`${section.heading} (${stamp})`),
    ...section.paragraphs.map(p),
    ...section.bullets.map(bulleted),
  ];
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
