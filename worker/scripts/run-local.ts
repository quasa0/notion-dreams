import { Client } from "@notionhq/client";
import { loadConfig } from "../src/config.js";
import { runDreams } from "../src/dreams.js";
import { reportMarkdown } from "../src/report.js";
import type { NotionClientLike } from "../src/types.js";

const token = process.env.NOTION_API_TOKEN;
if (!token) {
  throw new Error("Set NOTION_API_TOKEN before running npm run local.");
}

const notion = new Client({ auth: token }) as unknown as NotionClientLike;
const config = loadConfig();
const result = await runDreams(notion, config, undefined);

console.log(reportMarkdown(result));
