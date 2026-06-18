# Launching RecipeClip

Two things go live: the **backend** (a Cloudflare Worker) and the **extension**
(via the Chrome Web Store). Deploy the backend first, point the extension at it,
then publish.

## 1. Deploy the backend (Cloudflare Workers)

Prerequisites: a free Cloudflare account, then `npx wrangler login`.

```bash
cd backend

# Create the KV namespace for the recipe cache, then paste the returned id
# into wrangler.toml under [[kv_namespaces]] id = "...".
npx wrangler kv namespace create RECIPE_CACHE

# Store the API key as a secret (NOT in wrangler.toml).
npx wrangler secret put GEMINI_API_KEY

# Deploy. Note the URL it prints, e.g. https://recipeclip-backend.<you>.workers.dev
npx wrangler deploy
```

Verify by opening the deployed URL in a browser — you should see
`{"ok":true,"status":"RecipeClip backend OK"}`.

## 2. Point the extension at the deployed backend

Edit `extension/src/shared/config.ts` and set `BACKEND_URL` to your
`workers.dev` URL (no trailing slash). Then rebuild:

```bash
cd extension
npm run build      # dist/ is what you publish
```

## 3. Publish to the Chrome Web Store

One-time: register a Chrome Web Store developer account (a one-time $5 fee) in
the developer dashboard.

```bash
# Package the build
cd extension && (cd dist && zip -r ../recipeclip.zip .)   # -> extension/recipeclip.zip
```

In the dashboard: **New item → upload `recipeclip.zip`**, then complete the
listing:

- **Name, description, category** (Productivity).
- **Screenshots** (1280×800) and a **128×128 store icon**.
- **Privacy**: add a privacy-policy URL and justify each permission
  (`sidePanel`, `storage`, `activeTab`, `scripting`, host `youtube.com`).
  Disclose the data flow: the extension sends the video's title, description,
  and transcript to your backend, which calls the LLM to build the recipe.
- **Submit for review** (typically a few days, sometimes longer).

### Alternative: private / unlisted

You can publish as **Unlisted** (only people with the link can install) or just
share the zip for testers to **Load unpacked** — no review needed for that.

## Pre-launch checklist

- [ ] **Add an extension icon** (16/48/128 px) and reference it in
      `manifest.json` (`icons` + `action.default_icon`). The extension currently
      ships without one; the store requires it.
- [ ] `BACKEND_URL` points at the production Worker.
- [ ] `GEMINI_API_KEY` secret is set on Cloudflare (not only in `.dev.vars`).
- [ ] A privacy-policy page exists and is linked.
- [ ] Consider a usage cap / rate limit on the backend — the free Gemini tier
      has per-minute and per-day limits, and the Worker holds your key.
- [ ] Decide caching TTL (`CACHE_TTL_SECONDS` in `wrangler.toml`).

## What happens to user data

- Recipes the user saves stay in their browser (`chrome.storage.local`); they
  never leave the device.
- For extraction, the video title/description/transcript are sent to your
  backend and on to the LLM. The backend caches the result by video id in KV.
  No personal account or login is involved.
