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
