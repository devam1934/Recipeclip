# Changelog

All notable changes to RecipeClip are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed
- The servings scaler and unit toggle now also affect quantities written inside
  step text (e.g. "1 cup" → "2 cups" / "237 ml"), while deliberately leaving
  temperatures, times, counts, and pan sizes untouched.

### Added
- Extension icons (16/48/128) wired into the manifest and copied by the build.
- Friendly, retry-able message when the Gemini free-tier rate limit (HTTP 429)
  is hit, instead of a raw API error.
- One-time manual transcript fallback: when a video has captions but YouTube's
  newer panel won't let us auto-open the transcript, the panel now asks the user
  to open "Show transcript" once and click Get recipe again — we then read the
  loaded lines. Auto-extraction still happens with no extra clicks where
  possible. This makes the core "capture once, never rewatch" goal achievable on
  effectively any captioned video.

### Fixed
- Transcript-panel scrape now waits for the lazily-streamed segment list to
  finish loading (polls until the count stabilizes, up to 12s) instead of
  grabbing the first partial batch after a fixed 4s. Long transcripts (e.g. a
  ~9-minute video with 500+ lines) were timing out and yielding nothing on a
  cold open; the selectors were already correct.
- Read the current video via `#movie_player.getPlayerResponse()` instead of the
  stale `window.ytInitialPlayerResponse`, so clicking "Get recipe" after
  navigating to a new video (e.g. a recommendation) works without a page refresh.
- Near-empty extractions (no usable ingredients/steps, e.g. when the transcript
  is blocked and the description only links to an external recipe) now return an
  honest "couldn't read a full recipe" message instead of a broken one-line card.
- The "Get recipe" button now shows "Refresh page to use" when its content
  script has been orphaned by an extension reload, instead of doing nothing.
- When a transcript can't be fetched, sparse cooking videos are no longer
  rejected as "not a recipe" — the model now returns a low-confidence partial
  recipe with a note instead of a dead-end error.
- Poor results (non-recipe outcomes, or description-only extractions without a
  transcript) are no longer cached, so a later attempt can produce a better
  result instead of being stuck. Bumped the cache version to clear stale entries.
- Suppressed the "Extension context invalidated" error thrown by orphaned
  content scripts after the extension reloads (guard + stop the observer).
- Versioned the KV cache key so recipes cached under an older shape are
  re-extracted instead of served back missing newer fields.
- Hide the "Serves ?" chip when servings are unknown.
- Moved "Saved recipes" to its own top nav so the action row isn't crowded.

### Docs
- Added `docs/LAUNCH.md` (deploy backend, point the extension at it, publish).

### Added
- Dish backstory/origin and a chef's tip, plus a rough per-serving nutrition
  estimate shown as a macro ring (protein/carbs/fat) with calories — all folded
  into the existing extraction call.

### Removed
- The "Shop ingredients" button (Instacart needs a business API key). The
  backend `/shop` endpoint remains available behind `INSTACART_API_KEY` for
  later, but there's no UI for it.

### Added (earlier in this cycle)
- "Shop ingredients" button: builds an Instacart shoppable-recipe page from the
  current ingredients (cleaned names + scaled quantities, units mapped to
  Instacart's supported set) via a new `/shop` backend endpoint, and opens it in
  a new tab. Requires `INSTACART_API_KEY`.
- On-demand ingredient substitutions: a per-ingredient swap control fetches
  suggestions from a new `/substitute` endpoint (via the configured LLM behind
  the existing provider interface) and shows them inline.
- Ingredients / Steps / Overview tabs with a sticky header, so you switch
  instead of scrolling.
- Auto-extracted (free, same LLM call) summary, dietary tags, difficulty,
  cuisine, and equipment — shown in the header pills and the Overview tab.
- Unit conversion: an Orig / US / Metric toggle that converts ingredient
  amounts and units (volume + weight), composing with the servings scaler.
  Conversion math is unit-tested.
- Saved-recipes library: browse, search, open, and delete everything saved to
  chrome.storage, reachable from the bar and the idle screen.

### Changed
- Redesigned the side-panel card to be view-first and scannable: clean read-only
  view by default with an Edit toggle, meta shown as chips, and a confidence tag.
  Added tick-off checklists for ingredients and steps (persisted per video in
  chrome.storage), a servings scaler (½× / 1× / 2× that rescales amounts and
  servings on the fly), collapsible Ingredients/Steps sections, and timestamp
  "play" pills. New `scale.ts` quantity math is unit-tested.

### Added
- Project scaffold: `/extension` (Chrome MV3 + esbuild) and `/backend`
  (Cloudflare Worker), shared Recipe types, README, and tooling config.
- Isolated YouTube data-gathering module (`youtube/transcript.ts` +
  `youtube/page-reader.ts`): reads `ytInitialPlayerResponse` for title /
  description / caption tracks, fetches the timestamped transcript via
  `fmt=json3`, with a "Show transcript" panel scrape fallback. Typed failure
  signals for non-video and no-transcript pages.
- Backend extraction pipeline: request validation, fusion-rule prompt, and
  Claude integration via tool-use structured output behind a swappable
  `RecipeExtractor` interface. Handler validates input, detects non-recipe
  videos, and returns typed success/error JSON. Model output is normalized into
  a guaranteed-valid Recipe.
- Side-panel UI: content script injects a "Get recipe" button, service worker
  owns panel state + is the sole backend caller, and the panel renders
  loading / error / recipe views. Recipe card shows ingredients (with uncertain
  flags), numbered steps with clickable timestamps that seek the in-page video,
  a confidence badge, and notes. Typed message protocol across all three
  contexts; SPA-safe button re-injection.
- Editing + export + save: every card field is editable in place, ingredient
  and step rows can be added/removed, uncertain amounts toggle. Toolbar copies
  Markdown to the clipboard, downloads a `.md` file, and saves to
  `chrome.storage.local` (keyed by video id). The edited DOM is read back into a
  Recipe on demand (`readRecipeFromDom`).
- Backend caching: results are cached in Workers KV by video id (best-effort,
  with TTL), so each video costs at most one LLM call. Cache hits are flagged
  `cached: true` in the response.
- Google Gemini provider (`llm/gemini.ts`) using native JSON-schema structured
  output, now the default. Provider factory (`llm/index.ts`) selects between
  Gemini and Anthropic via the `LLM_PROVIDER` env var; Claude path unchanged.
  README + walkthrough updated for the free-tier setup.
- Polish: README "known limitations" + "failure handling" sections; verified
  pure logic (request validation, recipe normalization, prompt building,
  Markdown export) with passing unit checks; both halves typecheck and the
  extension builds clean.
