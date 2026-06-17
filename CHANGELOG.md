# Changelog

All notable changes to RecipeClip are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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
