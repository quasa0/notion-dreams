# Notion Dreams

Background Notion Worker that polishes pages changed since the previous run.

## Setup

Install dependencies:

```bash
cd worker
npm install
```

Install/login to the Notion CLI:

```bash
curl -fsSL https://ntn.dev | NTN_INSTALL_DIR="$HOME/.local/bin" bash
$HOME/.local/bin/ntn login
```

Configure secrets and target:

```bash
cp .env.example worker/.env
```

Set:

- `NOTION_API_TOKEN`
- `DREAMS_TARGET_PAGE_ID` or `DREAMS_TARGET_DATABASE_ID`
- `OPENAI_API_KEY` for LLM polishing; without it, the Worker falls back to a small local filler-word cleanup.

For deployed Workers:

```bash
$HOME/.local/bin/ntn workers env set NOTION_API_TOKEN=ntn_...
$HOME/.local/bin/ntn workers env set OPENAI_API_KEY=...
$HOME/.local/bin/ntn workers env set DREAMS_TARGET_PAGE_ID=...
```

## Verify

```bash
cd worker
npm run build
```

## Local Run

```bash
cd worker
npm run local
```

## Deploy

```bash
cd worker
$HOME/.local/bin/ntn workers deploy --name "Notion Dreams" --local-build
```

Manual demo trigger:

```bash
cd worker
$HOME/.local/bin/ntn workers sync trigger notionDreams
```

## Web UI

```bash
cd web
npm install
npm run dev -- --port 3000
```
