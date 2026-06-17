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
