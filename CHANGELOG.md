# Changelog

All notable changes to RecipeClip are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
