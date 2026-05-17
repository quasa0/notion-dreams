# Hacker Resources: Notion Developer Platform Hackathon

## Hackathon Schedule

### Saturday, May 16

- 9 a.m. — Check-in and light breakfast
- 10 a.m. — Kick off and demos
- 10:45 a.m. — Building begins
- 12:00 p.m. — Lunch served
- 6:00 p.m. — Dinner served
- 8:00 p.m. — End of day

### Sunday, May 17

- 9 a.m. — Arrival and light breakfast
- 12 p.m. — Project submission
- 12:15 p.m. — Judging deliberation and lunch
- 3:00 p.m. — Awards and closing

## Hackathon Rules

To keep things fair and aligned with our goals, all teams must follow these rules:

- Open Source: Everything shown in the demo must be fully open source. This includes every component - backend, frontend, models, and any other parts of the project - published under an approved open source license.
- New Work Only: All projects must be started from scratch during the hackathon with no previous work.
- Demo Requirements: Your demo must only highlight the specific features, code, and functionality that your team built during the hackathon.
- Banned Projects: Project will be disqualified if they: violate legal, ethical, or platform policies, use code, data, or assets you do not have the rights to.
- Team Size: Teams may have up to 4 members.
- Participants: Employees of partner companies in this hackathon are not eligible to participate.

Sample Anti-Projects to NOT DO — STRICTLY NO:

- Basic RAG applications
- Medical advice (e.g. mental health advisor, nutrition coach)
- "AI for education" chatbot
- "AI companion" chatbot
- Personality analyzers
- Anything NSFW
- Streamlit applications

## Build Themes

Your project must build in at least one of the three themes below.

### Theme One: The Autonomous Sidekick

Build something that acts—it notices, decides, and does the next step while you sleep. For example, have it run on a schedule and react to at least one trigger, maintain a “memory” over time, or produce a daily/weekly artifact that’s shareable.

Examples:

- Standup Writer — Runs every morning, reads your Notion project board, open PRs, and Linear tickets, and writes the day’s standup before you've had coffee. Flags blockers it detected and anything that's been in "in progress" longer than your team's average cycle time.
- Evening Mode Autopilot: Create a hands-off rule: when the calendar shows you’re out at night, it automatically starts the vacuum, adds a few groceries to your list, and drafts a quick “back later” text.
- Streak Forensics: When you miss a recurring habit, it writes the mini post-mortem with outlining what happened that day and what usually precedes misses.
- Hobby Helper Scorekeeper: Tracks your team or player, posts a hype recap, next game time and watch list into a Notion page daily.

### Theme Two: The Workflow Relay

Replace manual handoffs with an orchestrated flow that pulls, translates, and files information across systems. Have it touch multiple sources, include a translation layer, or add an an approval moment for anything risky/expensive/public.

Examples:

- Chief-of-Staff: A custom agent that’s given full situational awareness of what’s happening across a business—email threads, logs, Sentry alerts, payments, and support signals—plus the ability to take real action (including kicking off coding workflows when needed)
- Signal-to-Strategy Pipeline: After a Gong transcript lands, extract pain points and feature requests, map them to existing Jira/Linear issues (or create new), and draft the customer follow-up email. Requires approval before sending anything customer-facing.
- “Don’t Be Late” Birthday Buddy: watches your contacts and calendar for upcoming birthdays, pulls gift ideas from a wishlist or online cart, and creates a plan with buy / ship / message tasks (plus a pre-written text) so nobody gets the dreaded day-of scramble.

Check out Notion Product Designer, Brian Lovin’s “Side Project Chief of Staff” (https://x.com/brian_lovin/status/2026827356623745355)

### Theme Three: Chaos Mode

Build something slightly unhinged that still works. For some added chaos, you could include a persona (think butler, therapist, or sports announcer), use multimodal input (image, audio or screenshot) or build a single button that does something dramatic (“Initiate Night Mode” or “Deploy the butler”).

## Notion Hacker Guide

Hackathon participants will be granted a free 4-day Business trial and credits bundle to build.

All users MUST have a Notion account to get access to the upgrade and credits to build. If you don’t have one, sign up at Notion.com (http://Notion.com) and share your workspace ID (found under Settings → General) to lhorwitz@makenotion.com (mailto:lhorwitz@makenotion.com) no later than Thursday, May 14.

Note that for any workspace IDs shared after Thursday, May 14 EOD, upgrades and credits are not guaranteed.

### Introducing Workers

See the full overview here: https://developers.notion.com/workers/get-started/overview

Notion’s Developer Platform is built on two primitives:

- Workers — Notion’s hosted runtime for custom code. You write the code (often with a coding agent), deploy through the CLI, and it runs in a secure sandbox.
- ntn CLI — the command line interface that ships Workers, runs syncs, and keeps iteration tight.

From those primitives, you can start using these capabilities right now:

- Database sync — continuously sync external data into Notion
- Agent tools — build tools for your Custom Agents
- Webhooks — trigger Notion workflows from external events

### Getting Started

Install the CLI:

```bash
curl -fsSL https://ntn.dev | bash
```

Then:

1. Run `ntn login` to connect your Notion account.
2. Run `ntn workers new` to generate a starter project.
3. Deploy with `ntn deploy`, and use logs to iterate quickly.

### What You Can Do With The Developer Platform

#### 1. Sync any data source into Notion

Bring Zendesk tickets, Salesforce records, or any external data into a Notion database — and keep it continuously up to date. Sync the raw system-of-record data, then enrich it with Notion context so it becomes immediately useful to both humans and agents.

Recommended use cases:

- Sync from a Zendesk or Salesforce into a database in Notion, then layer in team-owned context (owners, next steps, priority).
- Bring in internal databases or systems into Notion, so your team and agents can work from the same source of truth.

#### 2. Build any tool for your Custom Agents

Give your Custom Agents the exact capabilities your workflows require. Tools run real code — so agents can encode business logic, fetch data, generate assets, and take action across other APIs.

Recommended use cases:

- Create an “ops helper” tool that looks up account status in an internal system and updates records based on information in Notion.
- Turn common scripts or workflow into a reusable tool your agents can call on demand.

#### 3. Trigger Notion workflows from anywhere (Webhooks)

Turn any external event into a Notion workflow. A Worker receives the webhook, validates it, runs your logic, and can take action in Notion or call other APIs.

Recommended use cases:

- GitHub: when a PR merges, update the related Notion task and draft a release note.
- Billing: when a subscription changes, create or update an account page and notify the right owner.

#### 4. Ship from your terminal with ntn

Notion’s CLI brings the full Notion API (pages, databases, search, files) plus Workers to your terminal. It’s built for you and agents alike — tight command surfaces, repeatable runs, and fast iteration.

### Other Resources

- Getting Started with Notion (https://www.notion.com/help/start-here)
- Workers docs (https://developers.notion.com/workers/get-started/overview)
- CLI docs (https://developers.notion.com/cli/get-started/overview)
- MCP Integration Overview (https://developers.notion.com/guides/mcp/overview)
- Custom Agents Overview (https://www.notion.com/help/custom-agents)
- Project & Task Tracker (https://www.notion.com/templates/projects-tasks): Manage your hackathon project timeline, tasks, and deliverables in one place. Track progress across team members and ensure nothing falls through the cracks.
- Engineering Tech Specs (https://www.notion.com/templates/category/engineering-tech-spec): Document your architecture, API endpoints, code structure, and setup instructions for judges and future reference.
- Browse all templates (https://www.notion.com/templates) to find more that fit your team's workflow.
- Help Center (https://www.notion.so/help)

## Judging & Submissions

Judging will take place on Sunday, May 17.

Judges are evaluating your technical demos in the following categories. Show us what you have built to solve our problem statements. Please do not show us a presentation. We'll be checking to ensure your project was built entirely during the event; no previous work is allowed.

Project submissions are due by 12 p.m. on Sunday, May 17.

How to submit your project:

1. You must be registered AND approved on the Cerebral Valley platform here: https://cerebralvalley.ai/e/notion-developer-platform-hackathon. Please do this ahead of the event, so we can ensure there are no delays.
2. Submit your project on the Cerebral Valley platform.

In the submission form, you will have to submit a short one minute demo video uploaded to Youtube, Loom, or somewhere else. This should be a video highlighting the specific features, code, and functionality that your team built during the hackathon.

Please double check that your repository is public, your demo link is accessible, and all team members have been added to the submission page.

### Judging Criteria

Please note: Final round judging criteria is the same as first round judging criteria, except for the removal of category weights.

### Judging Process

Judging proceeds in two rounds:

- Round 1: Hackers will be assigned to a group of judges, you'll have ~3 minutes to pitch followed by 1-2 minutes of Q&A
- Round 2: The top six teams in ranking will get to demo on stage to a panel of judges; ~3 minutes to pitch followed by 2-3 minutes for Q&A

## Judges

### First round judges

- Alfred Xing — MTS, Anthropic
- Alice Zhao — MTS, Anthropic
- Brian Lovin — Product, Notion
- Carter Pedersen — Engineering, Notion
- Charmaine Lee — Applied AI, Anthropic
- Cole Bemis — Product, Notion
- Jules Qiu — Investor, Radical Ventures
- Lakshmi Subbramanian — Head of Financial Infrastructure, Vercel
- Neena Parikh — Engineering, Notion
- Paul Scherer — Founder/CEO, Eigen

### Final round judges

- Andrew Qu — Chief of Software at Office of CTO, Vercel
- Anthony Morris — MTS, Claude Code, Anthropic
- Matt Palmer — Developer Experience, Conductor
- Max Schoening — Head of Product, Notion
- Mike Vernal — Investor, Conviction
- Pavla Bobosikova — Investor, Neo
- Simon Last — Co-founder, Notion

## Prizes

### 1st Place — $34,000+ value

- $7,000 in Anthropic API credits
- $5,000 in OpenAI API credits
- $1,800 in Vercel credits per team member
- $10,000 in PlanetScale credits
- $5,000 in MiniMax API credits
- One year free of Notion Business*
- 1:1 build session with a Notion Expert

### 2nd Place — $23,000+ value

- $5,000 in Anthropic API credits
- $3,000 in OpenAI API credits
- $1,200 in Vercel credits per team member
- $6,000 in PlanetScale credits
- $3,000 in MiniMax API credits
- One year free of Notion Business*
- 1:1 build session with a Notion Expert

### 3rd Place — $16,000+ value

- $3,000 in Anthropic API credits
- $2,000 in OpenAI API credits
- $600 in Vercel credits per team member
- $4,000 in PlanetScale credits
- $2,000 in MiniMax API credits
- One year free of Notion Business*
- 1:1 build session with a Notion Expert

### Terms for One year free of Notion Business

As a MWN hackathon winner, you will receive 12 months of a Notion Business plan for free.

You can apply this offer to an existing Notion workspace as long as that workspace is on the Free plan, has never had a paid subscription, and you're the only member and owner of the workspace. You can also create a new Notion workspace to take advantage of this offer.

### Raffle

Raffle for Mac Mini sponsored by MiniMax.

All attendees will be automatically entered into the raffle. Winner will be announced during the awards ceremony on Sunday, May 17.

## Discord And Questions

Join the Discord to meet other participants, get official updates, begin forming teams:

- Notion Developer Platform Hackathon (https://discord.gg/t847tGQbUC)

Getting Started:

- Onboarding: Once you join, please make sure to read the #rules and #announcement channels.
- Introduce yourself: In #intros, share who you are, the skills you bring, and what project you’re looking to build.
- Create a Team: In #team-search, find teammates before the hackathon (maximum team size of four).

Key Channels include:

- #general: Socialize and meet other hackers.
- #rules: On the day rules spanning from registration, product building, and pitching.
- #announcements: Official updates and reminders from the Notion Team.
- #intros: Introduce yourself and what you’re doing to everyone!
- #team-search: Find teammates before the hackathon (maximum team size of four).
- #questions: Ask any general questions to the Notion Team by pinging @Notion.

Please email lhorwitz@makenotion.com (mailto:lhorwitz@makenotion.com) or message the Notion team on Discord.

## Location, Wifi, Food

### Location

Notion HQ
20 Annie Street, San Francisco, CA 94105

### Wifi Information

Network: Notion Events

No password. Enter your name, email and complete captcha.

### Food & Drinks

Saturday & Sunday: Breakfast, lunch, dinner (Saturday only) as well as coffee, snacks and beverages will be provided.

Notion’s cafe, Ada’s, will be open during the below hours:

- Saturday, May 16 | 9am-3pm (Closed from 10am-11am during the welcome and demos)
- Sunday, May 17 | 9am-2pm
