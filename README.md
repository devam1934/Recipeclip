# RecipeClip

A Chrome extension (Manifest V3) that turns a YouTube cooking video into a
clean, editable recipe card. Click **Get recipe** on the watch page and you get
ingredients plus numbered steps, each step deep-linking back to its timestamp in
the video. Edit, copy, export to Markdown, and save locally.

## Architecture

Three cleanly separated parts:

1. **Extension (client)** — `extension/`. A content script injects the button
   and gathers data from the YouTube page. A side panel (the `chrome.sidePanel`
   API) renders the recipe card. The client **never** calls the LLM and **never**
   holds an API key. It only talks to our backend.

2. **Backend (one serverless function)** — `backend/`. A Cloudflare Worker that
   holds the LLM key, receives the gathered text, calls the LLM with structured
   output, returns recipe JSON, and caches results by video id in Workers KV.

3. **LLM** — Anthropic Claude, called with structured output (tool use). The
   provider sits behind a small interface (`backend/src/llm/provider.ts`) so it
   can be swapped.

```
extension/                 Chrome MV3 client (no API key)
  src/content/             injects the "Get recipe" button
  src/youtube/             ⚠ all fragile YouTube scraping, isolated here
  src/sidepanel/           renders + edits the recipe card
  src/background/          service worker: opens panel, calls backend
  src/shared/              Recipe types (mirrors backend)
backend/                   Cloudflare Worker (holds the key)
  src/handler.ts           HTTP entry: validate -> extract -> cache
  src/extract.ts           prompt build + fusion rules
  src/llm/                 swappable LLM interface + Claude impl
  src/cache.ts             cache by video id (Workers KV)
```

### Why the YouTube logic is quarantined

YouTube changes its page internals without warning. All of the brittle bits
(reading `ytInitialPlayerResponse`, the `captionTracks[].baseUrl` + `&fmt=json3`
fetch, and the "Show transcript" panel scrape fallback) live in **one** module,
`extension/src/youtube/transcript.ts`, so they can be patched in isolation when
YouTube breaks.

## Data flow

1. Content script injects a **Get recipe** button near the video.
2. On click it reads the timestamped transcript (`fmt=json3`, with a transcript-
   panel scrape as fallback) and collects video id, title, and description.
3. The service worker POSTs that payload to the backend.
4. The backend prompts Claude for structured recipe JSON, applying the fusion
   rule (description wins for exact quantities; transcript provides step order +
   timestamps; uncertain amounts are flagged, not invented; non-recipe videos
   are detected and signalled).
5. The backend caches by video id and returns the JSON.
6. The side panel renders an editable card with timestamp deep-links. The user
   edits, copies, exports Markdown, and saves to `chrome.storage`.

## Recipe shape

```jsonc
{
  "title": "string",
  "servings": "string | null",
  "totalTime": "string | null",
  "ingredients": [{ "name": "string", "amount": "string | null", "unit": "string | null", "uncertain": false }],
  "steps": [{ "instruction": "string", "timestamp": 0 }],
  "notes": "string | null",
  "sourceConfidence": "high | medium | low",
  "isRecipe": true
}
```

## Running the backend locally

Requires Node 18+ and a Cloudflare account for `wrangler` (free tier is fine).

```bash
cd backend
npm install
cp .env.example .dev.vars      # then put your real ANTHROPIC_API_KEY in .dev.vars
npm run dev                    # wrangler dev -> http://localhost:8787
```

`.dev.vars` is how Wrangler injects secrets locally; it is gitignored. For
deploys, set the secret with `npx wrangler secret put ANTHROPIC_API_KEY`.

## Loading the extension

```bash
cd extension
npm install
npm run build                  # outputs to extension/dist/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select `extension/dist/`. Open a YouTube cooking video and click
**Get recipe**.

By default the extension points at `http://localhost:8787`. See
`extension/src/shared/config.ts` to change the backend URL.

## Required env vars

| Var                 | Where        | Purpose                          |
| ------------------- | ------------ | -------------------------------- |
| `ANTHROPIC_API_KEY` | backend only | Auth for the Claude API.         |

The key lives only in the backend. The extension never sees it.

## Scope

**v1:** description + transcript only; one cached LLM call per video; graceful
handling of no-transcript, non-recipe, and network-error cases.

**Out of scope (v2+):** comment mining, OCR of on-screen quantities, multi-recipe
videos, accounts/auth, payments.
