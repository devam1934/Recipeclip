# RecipeClip code walkthrough

This is a guided tour of every source file, written so you can understand what
each part does and why. Read the "Big picture" first, then go file by file.
Where the logic is subtle, the explanation walks through it step by step.

---

## Big picture: one click, end to end

When you click **Get recipe** on a YouTube watch page, here's the full journey:

1. **`content/inject-button.ts`** (runs inside the YouTube page) handles the
   click. It immediately asks the service worker to open the side panel, then
   calls `gatherVideoData()`.
2. **`youtube/transcript.ts`** does the scraping: it injects
   **`youtube/page-reader.ts`** into the page to read YouTube's internal
   `ytInitialPlayerResponse` (title, description, caption-track URLs), fetches
   the timestamped transcript, and returns a clean `ExtractRequest`.
3. The content script sends that `ExtractRequest` to
   **`background/service-worker.ts`**.
4. The service worker POSTs it to the backend and tracks the UI state.
5. **`backend/src/handler.ts`** receives the POST, checks the KV cache
   (**`cache.ts`**), and if it's a miss calls the configured LLM provider
   (**`llm/gemini.ts`** by default, or **`llm/anthropic.ts`**), which fills in a
   structured recipe (the prompt + rules live in **`extract.ts`**). It caches the
   result and returns recipe JSON.
6. The service worker stores the result and broadcasts it.
7. **`sidepanel/panel.ts`** renders the editable card. You edit, then
   **`export.ts`** turns it into Markdown and **`storage.ts`** saves it.

Three contexts, three trust levels: the **content script** can touch the
YouTube page but is "dumb"; the **service worker** is the coordinator and the
only thing that talks to the backend; the **backend** is the only thing that
holds the API key.

---

## Shared types — the vocabulary

### `extension/src/shared/types.ts` (and its twin `backend/src/types.ts`)

These two files define the data shapes everything else speaks in: `Recipe`,
`Ingredient`, `Step`, `TranscriptSegment`, `ExtractRequest`, and
`ExtractResponse`. They're duplicated (not shared via a package) on purpose —
keeping one small file in sync by hand is cheaper than the build tooling a
shared workspace package would add.

Key shapes:

- `Ingredient` has `amount` and `unit` that can be `null`, plus an `uncertain`
  boolean. That `uncertain` flag is the heart of the "don't invent quantities"
  rule — the model marks a guessed amount instead of pretending it's exact.
- `Step` has an `instruction` and a `timestamp` in seconds (or `null`). The
  seconds are what power the "jump to this part of the video" links.
- `ExtractResponse` is a *discriminated union*: either
  `{ ok: true, recipe, cached }` or `{ ok: false, error, message }`. The `ok`
  field lets TypeScript (and you) branch safely — if `ok` is true, `recipe`
  exists; if false, `error` exists. No guessing.
- `backend/src/types.ts` additionally has `Env`, which describes the bindings
  the Worker gets at runtime: the API key, the KV namespace, and the TTL.

### `extension/src/shared/config.ts`

One line: `BACKEND_URL`. The single place to point the extension at its backend.
Local dev uses `http://localhost:8787`; change it here for production.

### `extension/src/shared/messages.ts`

The typed "contract" for messages passed between the three contexts. `PanelState`
describes what the panel is showing (`idle` / `loading` / `ready` / `error`) and
the `Message` union lists every message that can be sent, annotated with its
direction (content→worker, panel→worker, worker→panel). `isMessage()` is a small
guard so message handlers can safely check `typeof value === "object"` and that
it has a string `type` before trusting it. Centralizing this means the wiring is
impossible to get subtly wrong — the compiler checks every send and receive.

---

## The extension

### `extension/manifest.json`

The extension's manifest (Manifest V3). The important entries:

- `permissions`: `sidePanel` (open the panel), `storage` (save recipes),
  `activeTab`/`scripting`.
- `host_permissions`: limited to `youtube.com`.
- `background.service_worker`: points at the built worker; `type: module` lets
  it use ES imports.
- `side_panel.default_path`: the panel's HTML.
- `content_scripts`: injects `content/inject-button.js` on watch pages only
  (`youtube.com/watch*`), at `document_idle` (after the page settles).
- `web_accessible_resources`: exposes `youtube/page-reader.js` to the page. This
  is required because the content script injects that file into the page's own
  JavaScript world (explained below), and Chrome blocks that unless the file is
  declared accessible.

### `extension/build.mjs`

A ~50-line esbuild script — deliberately plain so you can read exactly what's
bundled. It defines `entryPoints` (the three main scripts → `dist/.../*.js`) and
a separate `pageScript` for `page-reader.ts`. The page reader is built as an
`iife` (a classic, self-running script) rather than an ES module, because it
runs in the page's main world where module loading isn't available. `copyStatic`
copies `manifest.json` and `panel.html` verbatim. With `--watch` it rebuilds on
every change.

### `extension/src/youtube/page-reader.ts` — the main-world spy

This is tiny but conceptually important. A content script runs in an *isolated
world*: it shares the page's DOM but **not** its JavaScript variables. YouTube
stores the data we want in a page global, `window.ytInitialPlayerResponse`, which
the content script therefore cannot see.

The fix: this file is injected *into the page's own world*, where that global is
visible. It reads `ytInitialPlayerResponse` and hands it back across the world
boundary using `window.postMessage(...)` — the one channel both worlds share. It
tags the message with `__recipeclip: "recipe-page-reader"` so the content script
can recognize it. It's injected fresh on each click so it always reflects the
video currently open (YouTube swaps videos without a full reload).

### `extension/src/youtube/transcript.ts` — the quarantine zone

**This is the most fragile file and the most important to understand.** Every
piece of YouTube-specific scraping lives here so that when YouTube changes its
internals, this is the only file you patch. Walking through it:

- **`NoTranscriptError` / `NotAVideoError`**: custom error classes for the two
  expected failure cases. Throwing typed errors (instead of returning null
  everywhere) lets the caller show the right message.

- **`gatherVideoData()`** is the orchestrator and the only export the rest of
  the extension uses. It: gets the player response, pulls `videoId` / `title` /
  `description` out of it (falling back to the URL and page title), gets the
  transcript, and returns a clean `ExtractRequest`. If there are no transcript
  segments it throws `NoTranscriptError`.

- **`getPlayerResponse()`** tries the live in-page global first (via the page
  reader) and falls back to parsing it out of the page's HTML.

- **`readPlayerResponseFromPage()`** is the handshake with the page reader. It
  returns a `Promise` that: registers a `message` listener, injects the
  page-reader `<script>` (`chrome.runtime.getURL` resolves the bundled file's
  URL), and resolves when the tagged message arrives. The `settled` flag and the
  `setTimeout(..., 3000)` guarantee the promise resolves exactly once even if the
  message never comes — no hanging forever.

- **`parseInlinePlayerResponse()`** is the last resort. It scans every
  `<script>` tag for the text `ytInitialPlayerResponse`, finds the opening `{`,
  and extracts a balanced JSON object with **`sliceBalancedJson()`** — a small
  parser that walks character by character, tracking string state (so braces
  inside quoted text don't count) and brace depth, returning the substring when
  depth returns to zero. This is more robust than a regex, which would choke on
  nested braces.

- **`getTranscript()`** prefers the caption-track fetch and falls back to
  scraping the on-page transcript panel.

- **`pickCaptionTrack()`** chooses the best track: a manual English track first,
  then auto-generated ("asr") English, then whatever exists.

- **`fetchCaptionTrack()`** takes the track's `baseUrl`, appends
  `fmt=json3` (YouTube's JSON caption format), fetches it, and converts each
  `event` into a `{ start, text }` segment. `tStartMs` is milliseconds, so it's
  divided by 1000 and rounded to whole seconds; whitespace is collapsed and
  empty segments dropped.

- **`scrapeTranscriptPanel()`** is the fallback for when the JSON endpoint is
  blocked. It opens the panel (`openTranscriptPanel()` finds and clicks a button
  whose text/aria-label contains "transcript"), waits for the rows to render
  (`waitForElements` polls every 150ms up to 4s), then reads the timestamp
  (`.segment-timestamp`) and text (`.segment-text`) from each row.

- **Helpers**: `parseTimestamp("1:23")` → `83` seconds (folds the colon-separated
  parts left to right). `getVideoIdFromUrl()` reads `?v=`. `delay()` is a
  promise-based sleep.

### `extension/src/content/inject-button.ts` — the button + seek

The content script. Two jobs:

1. **Place the button and handle the click.** `createButton()` builds the styled
   button. `onClick()` is the choreography: it disables the button, sends
   `PANEL_OPEN` *first* (this must happen synchronously inside the click so the
   browser still considers it a "user gesture" — Chrome only lets you open the
   side panel in response to one), then `await`s `gatherVideoData()` and sends
   either an `EXTRACT_REQUEST` with the data or a `GATHER_ERROR` with a typed
   code. The `try/catch` maps each error class to the right code.

2. **Seek the video.** It listens for `SEEK` messages and sets the `<video>`
   element's `currentTime`, so clicking a timestamp in the panel jumps the video.

`injectButton()` finds a spot near the title and inserts the button (with a
floating fallback if the title isn't found). Because YouTube is a single-page
app, the bottom of the file re-runs injection on `yt-navigate-finish` (their
in-app navigation event) and via a `MutationObserver` (for late re-renders),
with a guard (`if (document.getElementById(BUTTON_ID)) return;`) so it never
adds duplicates.

### `extension/src/background/service-worker.ts` — the coordinator

The only context that talks to the backend, and the owner of the UI state.

- **`currentState`** is a single in-memory `PanelState`. v1 assumes one active
  recipe at a time, so one value is enough. **`setState()`** updates it and
  broadcasts a `STATE_UPDATE` to the panel; the `.catch(() => {})` swallows the
  "no receiver" error that occurs when the panel isn't open yet.

- The **`onMessage` listener** is a switch over message types: `PANEL_OPEN` opens
  the panel and shows loading; `EXTRACT_REQUEST` kicks off `runExtraction`;
  `GATHER_ERROR` shows the error; `GET_STATE` replies synchronously with the
  current state (the panel asks for this when it first loads); `SEEK` forwards
  the seek to the active tab.

- **`runExtraction()`** is the backend call: `fetch(BACKEND_URL, { POST, JSON })`,
  parse the `ExtractResponse`, and translate it into a `ready` or `error` state.
  The `try/catch` turns a network failure (backend not running) into a friendly
  message rather than a crash.

### `extension/src/sidepanel/panel.html`

The panel's shell: a single `#app` container, a `<script>` tag loading the built
`panel.js`, and an inline `<style>` block. The CSS includes a dark-mode variant
via `@media (prefers-color-scheme: dark)` and styles for the editable fields,
add/remove-row buttons, and toolbar. Keeping styles inline keeps the panel a
self-contained unit.

### `extension/src/sidepanel/panel.ts` — the editable card

The biggest UI file. How it works:

- **Bootstrap**: on load it sends `GET_STATE` to learn what to show, and listens
  for `STATE_UPDATE` broadcasts. Both call `render()`.

- **`render()` / `viewFor()`** clear `#app` and draw the view for the current
  state: a friendly message (idle), a spinner (loading), an error, or the recipe
  card (ready). On "ready" it stashes `currentVideoId` for deep-links and saving.

- **`recipeCard()`** builds the card out of *editable* elements. Every field
  (`editable(...)`) is a `contentEditable` node with a placeholder. Ingredients
  and steps are rows with their own editable spans plus a remove (`✕`) button,
  and each list has an "+ ingredient" / "+ step" button that appends a blank row.
  The "approx" chip (`uncertainToggle`) toggles an `.on` class when clicked.

- **The key idea — DOM as the source of truth while editing.** Rather than
  syncing every keystroke back into a JavaScript object, the card just *is* the
  editable state. When you Copy/Export/Save, **`readRecipeFromDom()`** walks the
  card and reconstructs a `Recipe`: it reads each ingredient row's amount/unit/
  name and whether its chip is `.on`, reads each step's text and its `data-ts`
  timestamp, and pulls title/servings/notes from their fields. Empty rows are
  filtered out. This keeps the editing code simple.

- **`timestampLink()`** makes a clickable timestamp that (a) sends a `SEEK`
  message to jump the in-page video and (b) has a real `href` to
  `youtube.com/watch?v=...&t=...s` as a fallback if you open it in a new tab.

- **Toolbar actions**: `onCopy` writes Markdown to the clipboard; `onExport`
  builds a `Blob`, makes an object URL, and clicks a hidden `<a download>` to
  save a `.md` file; `onSave` writes to `chrome.storage`. `setStatus()` shows a
  little confirmation line.

### `extension/src/sidepanel/export.ts`

A pure function, `toMarkdown(recipe)`, with no dependencies — easy to test and
reused by both Copy and Export. It assembles the Markdown line by line: an `#`
title, an italic meta line (serves / time), an `## Ingredients` bullet list
(amount + unit + name, with `_(approx)_` on uncertain ones), a numbered
`## Steps` list with `_(m:ss)_` timestamps, and `## Notes`. `formatTimestamp()`
converts seconds to `m:ss` or `h:mm:ss`.

### `extension/src/sidepanel/storage.ts`

A thin wrapper over `chrome.storage.local`. `saveRecipe(videoId, recipe)` stores
`{ recipe, savedAt }` under the key `recipe:<videoId>`; `loadRecipe(videoId)`
reads it back. Keeping the key format and shape in one file means the rest of the
code never hard-codes storage details. (`loadRecipe` is exported for a future
"saved recipes" view.)

---

## The backend (Cloudflare Worker)

### `backend/wrangler.toml`

Wrangler's config. `main` points at the handler; `nodejs_compat` lets the
Anthropic SDK run. The `[[kv_namespaces]]` block binds `RECIPE_CACHE` (you create
the namespace once with `wrangler kv namespace create` and paste its id; local
dev uses an automatic local namespace). `[vars]` holds non-secret config like the
cache TTL — the API key is deliberately **not** here; it's a secret.

### `backend/src/extract.ts` — validation, prompt, and the fusion rules

Provider-agnostic logic, so it stays the same no matter which LLM you use.

- **`parseExtractRequest(body)`** validates the untrusted POST body and returns a
  clean `ExtractRequest` or `null`. It checks that `videoId`/`title`/
  `description`/`segments` are the right types, and rebuilds the segment list,
  dropping blank lines and defaulting/ rounding `start`. Never trust input from
  the network.

- **`SYSTEM_PROMPT`** is where the **fusion rules** live, in plain English for
  the model: the *description* is the highest-priority source for exact
  quantities; the *transcript* drives step order and timestamps; never invent
  amounts (flag them `uncertain` instead); and if the video isn't a recipe, set
  `isRecipe: false` rather than fabricating one. This is the "brain" of the
  extraction, and it's just text you can tweak.

- **`buildUserPrompt(req)`** formats the actual video data for the model: title,
  description, and the transcript rendered as `[seconds] text` lines so the model
  can copy those integers straight into step timestamps.
  **`formatTranscript()`** also truncates very long transcripts to a safe length
  so a 2-hour video can't blow the token budget.

- **`normalizeRecipe(raw)`** is the safety net. The model is *told* to follow the
  schema, but this coerces whatever comes back into a guaranteed-valid `Recipe`:
  trims strings, defaults `isRecipe` to true unless explicitly false, clamps
  `sourceConfidence` to one of the three allowed values, and normalizes each
  ingredient/step. The small `asString` / `asNullableString` / `asConfidence`
  helpers do the field-level coercion.

### `backend/src/llm/provider.ts` — the swappable seam

Just an interface, `RecipeExtractor`, with one method: `extract(input)`. The rest
of the backend depends only on this, never on a specific vendor. To switch LLM
providers you write a new class implementing this interface and change one line
in the handler. `LlmError` is the single error type for any provider/transport
failure.

### `backend/src/llm/anthropic.ts` — the Claude implementation

The vendor-specific half.

- **`RECIPE_TOOL`** defines a "tool" named `save_recipe` whose `input_schema` is
  our `Recipe` shape expressed as JSON Schema. This is the trick for **structured
  output**: instead of asking Claude for prose and parsing it, we give it a tool
  and force it to "call" that tool, so the response is guaranteed to be a JSON
  object matching the schema.

- **`AnthropicExtractor.extract()`** calls `messages.create` with the system
  prompt, the user prompt, the tool, and `tool_choice: { type: "tool", name:
  "save_recipe" }` — the `tool_choice` is what *forces* the tool call. It then
  finds the `tool_use` block in the response, and passes its `input` through
  `normalizeRecipe()` before returning. Any API failure is wrapped in `LlmError`.
  The model name is a constant (`MODEL`) at the top — change it in one place.

### `backend/src/llm/gemini.ts` — the Gemini implementation (default)

The free-tier provider, and the default. Like the Claude version it produces
**structured output**, but via Gemini's mechanism: the request includes a
`responseSchema` plus `responseMimeType: "application/json"`, so the model
returns a JSON object matching our `Recipe` shape. One wrinkle to know about:
Gemini's schema dialect marks optional fields with `nullable: true` rather than
JSON Schema's `["string", "null"]` union, so `RECIPE_SCHEMA` here looks slightly
different from the Anthropic tool schema. It calls the REST endpoint directly
with `fetch` (no SDK — one endpoint, zero dependencies, runs natively on the
Worker), then parses `candidates[0].content.parts[0].text` and runs it through
`normalizeRecipe()`. Failures become `LlmError`. The model is the `MODEL`
constant (`gemini-2.5-flash`).

### `backend/src/llm/index.ts` — the provider factory

`createExtractor(env)` is the one place that knows about concrete providers. It
reads `env.LLM_PROVIDER` ("gemini" by default, or "anthropic"), checks the
matching API key is present, and returns the right `RecipeExtractor`. Adding a
new provider means writing its class and adding one `case` here — nothing else
in the backend changes. `handler.ts` just calls `createExtractor(env)`.

### `backend/src/cache.ts` — one LLM call per video

`getCachedRecipe` / `cacheRecipe` read and write the KV namespace keyed by video
id. Both are **best-effort**: wrapped in `try/catch` that returns null / does
nothing on failure, so a cache outage degrades to "slower" (a fresh extraction),
never "broken". `ttlSeconds()` reads the configured TTL with a sane default and a
60-second floor (KV's minimum).

### `backend/src/handler.ts` — the entry point

Ties it all together. `fetch(request, env)` is the Worker's HTTP handler:

- Handles CORS preflight (`OPTIONS`) and a `GET` health check.
- For `POST`: parses JSON, runs `parseExtractRequest` (400 on bad input), and
  returns `no_transcript` (422) if there are no segments.
- **The pipeline**: check the cache first — a hit returns immediately via
  `respondWith(cached, true)` with no LLM call. On a miss it creates the
  `AnthropicExtractor`, extracts, caches the result, and returns
  `respondWith(recipe, false)`.
- **`respondWith()`** centralizes the success/non-recipe branch: if
  `recipe.isRecipe` is false it returns the typed `not_a_recipe` signal;
  otherwise the recipe with a `cached` flag.
- The outer `try/catch` maps `LlmError` to a `502` and anything else to a `500`.
- `json()` and `fail()` are small response builders that always attach the CORS
  headers.

---

## Where to start changing things

- **Tweak how recipes are extracted** → `extract.ts` (`SYSTEM_PROMPT`).
- **YouTube broke** → `youtube/transcript.ts` only.
- **Change the look of the card** → `panel.html` (styles) + `panel.ts` (markup).
- **Swap the LLM** → set `LLM_PROVIDER` in `wrangler.toml` (`gemini` /
  `anthropic`). Add a provider → new class implementing `RecipeExtractor` + one
  `case` in `llm/index.ts`.
- **Change the export format** → `export.ts`.
