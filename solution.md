# Notion Dreams

## Idea

Notion Dreams is a scheduled Notion Worker that improves pages while you are away. It scans pages changed since the last run, removes filler, tightens wording, preserves meaning, writes improvements back to Notion, and stores a full change report.

Inspired by Anthropic’s Claude Managed Agents Dreams: a background process that reviews past work and improves memory over time. References: https://claude.com/blog/new-in-claude-managed-agents and https://platform.claude.com/docs/en/managed-agents/dreams.

## Why

Notion pages get messy during real work: meeting notes are rushed, project docs get verbose, updates contain filler, and people rarely come back to polish. Notion Dreams makes the workspace read better automatically.

Hackathon fit: Chaos Mode because the workspace quietly edits itself. Autonomous Sidekick because it runs on a schedule without prompting.

## Behavior

Run loop: read `last_run_at`, find pages where `last_edited_time > last_run_at`, read editable text blocks, polish candidate blocks, update blocks in place, write `Dreams/<date-time>-report`, save new `last_run_at`.

Text to process: paragraphs, headings, todos, callouts, quotes, bulleted lists, numbered lists.

Text to skip: code blocks, locked/high-risk pages, very short blocks, already-clear text, anything where meaning preservation is uncertain.

Editing rules: remove filler, shorten long sentences, improve clarity, preserve facts, decisions, TODOs, links, names, dates, numbers, structure, and technical terms.

Never do: invent facts, change commitments, change dates, delete TODOs, rewrite code, or rewrite if the cleaned version changes meaning.

## MVP

Scope: one configured page tree or database. Schedule: daily Worker sync, manually triggered for demo. Language: TypeScript. Platform: Notion Workers plus `ntn` CLI.

Core pieces: Config Store, Scanner, Block Reader, Polisher, Validator, Action Executor, Report Writer.

LLM use: ask for a cleaner version of each candidate block. Validator checks important tokens and rejects risky rewrites.

## Report

Location: `Dreams/<date-time>-report`.

Contents: run timestamp, pages scanned, blocks reviewed, blocks changed, skipped blocks, page reference for each changed block, before text, after text, reason for edit.

Purpose: full audit trail, not just examples.

## Demo

Show messy Notion notes. Trigger Worker manually. Show changed wording in the page. Open `Dreams/<date-time>-report` and show the full dump of edits.
