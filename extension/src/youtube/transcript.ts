// ⚠ QUARANTINE ZONE — all fragile, YouTube-specific scraping lives here.
//
// YouTube changes its page internals without notice. When recipe gathering
// breaks, it almost certainly broke here, and this is the only file that should
// need patching. Everything outside this module deals in clean typed data
// (ExtractRequest), never in YouTube DOM or player internals.
//
// Strategy, in order of preference:
//   1. Read `ytInitialPlayerResponse` (via the injected main-world page-reader)
//      for title, description, and caption-track URLs.
//   2. Fetch the timestamped transcript from a caption track as `fmt=json3`.
//   3. Fallback: open the "Show transcript" panel and scrape it from the DOM.

import type { ExtractRequest, TranscriptSegment } from "../shared/types";

/** Thrown when the page has no usable transcript by any method. */
export class NoTranscriptError extends Error {
  constructor(message = "This video has no transcript available.") {
    super(message);
    this.name = "NoTranscriptError";
  }
}

/** Thrown when we can't identify a YouTube video on the current page. */
export class NotAVideoError extends Error {
  constructor(message = "No YouTube video found on this page.") {
    super(message);
    this.name = "NotAVideoError";
  }
}

const PAGE_READER_MESSAGE_TAG = "recipeclip-page-reader";
const PAGE_READER_PATH = "youtube/page-reader.js";
const PAGE_READER_TIMEOUT_MS = 3000;
const PANEL_WAIT_MS = 4000;

// --- Minimal shapes of the YouTube internals we touch. Intentionally loose. ---

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string; // "asr" for auto-generated
  name?: { simpleText?: string };
}

interface PlayerResponse {
  videoDetails?: {
    videoId?: string;
    title?: string;
    shortDescription?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
}

interface Json3Event {
  tStartMs?: number;
  segs?: { utf8?: string }[];
}

/**
 * Gather everything the backend needs from the current watch page.
 * Throws NotAVideoError or NoTranscriptError on the expected failure paths so
 * the UI can show a clean message.
 */
export async function gatherVideoData(): Promise<ExtractRequest> {
  const player = await getPlayerResponse();

  const videoId = player?.videoDetails?.videoId ?? getVideoIdFromUrl();
  if (!videoId) throw new NotAVideoError();

  const title =
    player?.videoDetails?.title ??
    document.title.replace(/ - YouTube$/, "").trim();
  const description = player?.videoDetails?.shortDescription ?? "";

  const segments = await getTranscript(player);

  console.info("[RecipeClip] gathered", {
    videoId,
    title,
    descriptionChars: description.length,
    segments: segments.length,
  });

  // Graceful degradation: a missing transcript is fine as long as we have a
  // description to work from (many cooking videos put the full recipe there).
  // Only give up when we have neither.
  if (segments.length === 0 && description.trim() === "") {
    throw new NoTranscriptError(
      "This video has no transcript or description to read a recipe from.",
    );
  }

  return { videoId, title, description, segments };
}

// --- Player response -------------------------------------------------------

/**
 * Get the player response, preferring the live in-page global (accurate after
 * SPA navigation) and falling back to the inline <script> in the page HTML.
 */
async function getPlayerResponse(): Promise<PlayerResponse | null> {
  const fromPage = await readPlayerResponseFromPage();
  if (fromPage) return fromPage;
  return parseInlinePlayerResponse();
}

/** Inject the main-world reader and await its postMessage (with a timeout). */
function readPlayerResponseFromPage(): Promise<PlayerResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PlayerResponse | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(value);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__recipeclip !== PAGE_READER_MESSAGE_TAG) return;
      finish((data.playerResponse as PlayerResponse) ?? null);
    };

    window.addEventListener("message", onMessage);

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(PAGE_READER_PATH);
    script.onload = () => script.remove(); // executes on insert; clean up node
    (document.head ?? document.documentElement).appendChild(script);

    setTimeout(() => finish(null), PAGE_READER_TIMEOUT_MS);
  });
}

/** Last resort: pull `ytInitialPlayerResponse = {...}` out of the page HTML. */
function parseInlinePlayerResponse(): PlayerResponse | null {
  for (const script of Array.from(document.scripts)) {
    const text = script.textContent;
    if (!text || !text.includes("ytInitialPlayerResponse")) continue;
    const start = text.indexOf("{", text.indexOf("ytInitialPlayerResponse"));
    if (start === -1) continue;
    const json = sliceBalancedJson(text, start);
    if (!json) continue;
    try {
      return JSON.parse(json) as PlayerResponse;
    } catch {
      // keep scanning other script tags
    }
  }
  return null;
}

/** Return the substring from `start` that is a single balanced {...} object. */
function sliceBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// --- Transcript ------------------------------------------------------------

/** Try caption tracks first, then the on-page transcript panel. */
async function getTranscript(
  player: PlayerResponse | null,
): Promise<TranscriptSegment[]> {
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  console.debug("[RecipeClip] caption tracks available:", tracks?.length ?? 0);

  const track = pickCaptionTrack(tracks);
  if (track) {
    try {
      const segments = await fetchCaptionTrack(track.baseUrl);
      console.debug("[RecipeClip] json3 caption segments:", segments.length);
      if (segments.length > 0) return segments;
    } catch (err) {
      console.debug("[RecipeClip] caption fetch failed, will scrape panel:", err);
    }
  }

  console.debug("[RecipeClip] falling back to transcript-panel scrape");
  const scraped = await scrapeTranscriptPanel();
  console.debug("[RecipeClip] transcript-panel segments:", scraped.length);
  return scraped;
}

/** Prefer a manual English track, then auto English, then anything. */
function pickCaptionTrack(
  tracks: CaptionTrack[] | undefined,
): CaptionTrack | null {
  if (!tracks || tracks.length === 0) return null;
  const isEnglish = (t: CaptionTrack) => t.languageCode?.startsWith("en");
  return (
    tracks.find((t) => isEnglish(t) && t.kind !== "asr") ??
    tracks.find(isEnglish) ??
    tracks[0]
  );
}

/** Fetch a caption track as JSON3 and convert it to timestamped segments. */
async function fetchCaptionTrack(
  baseUrl: string,
): Promise<TranscriptSegment[]> {
  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set("fmt", "json3");

  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) throw new Error(`caption fetch failed: ${res.status}`);

  // YouTube increasingly returns an empty body here (the endpoint now wants a
  // token). Read text first and treat empty as "no captions this way" rather
  // than letting JSON.parse throw a noisy SyntaxError.
  const raw = await res.text();
  if (!raw.trim()) {
    console.debug("[RecipeClip] caption endpoint returned an empty body");
    return [];
  }

  const data = JSON.parse(raw) as { events?: Json3Event[] };
  const segments: TranscriptSegment[] = [];
  for (const event of data.events ?? []) {
    const text = (event.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    segments.push({ start: Math.round((event.tStartMs ?? 0) / 1000), text });
  }
  return segments;
}

/**
 * Fallback: programmatically open "Show transcript" and read the panel rows.
 * Slower and more brittle than the caption fetch, but works when the JSON3
 * endpoint is blocked.
 */
async function scrapeTranscriptPanel(): Promise<TranscriptSegment[]> {
  await openTranscriptPanel();
  const rows = await waitForElements(
    "ytd-transcript-segment-renderer",
    PANEL_WAIT_MS,
  );

  const segments: TranscriptSegment[] = [];
  for (const row of rows) {
    const stamp = row
      .querySelector(".segment-timestamp")
      ?.textContent?.trim();
    const text = row.querySelector(".segment-text")?.textContent?.trim();
    if (!text) continue;
    segments.push({ start: parseTimestamp(stamp ?? "0"), text });
  }
  return segments;
}

/** Click the "Show transcript" control if the panel isn't already open. */
async function openTranscriptPanel(): Promise<void> {
  if (document.querySelector("ytd-transcript-segment-renderer")) return;

  // The "Show transcript" button lives inside the description, which is
  // collapsed by default — expand it first so the button is in the DOM.
  const expand = document.querySelector<HTMLElement>(
    "tp-yt-paper-button#expand, #expand, #description #expand",
  );
  expand?.click();
  await delay(300);

  const button = findButtonByText(["show transcript", "transcript"]);
  if (!button) {
    console.warn("[RecipeClip] could not find a 'Show transcript' button");
    return;
  }
  button.click();
  // Give YouTube a beat to render the panel before the caller polls for rows.
  await delay(500);
}

/** Find a clickable element whose visible text/aria-label matches a phrase. */
function findButtonByText(phrases: string[]): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("button, a, tp-yt-paper-item, yt-button-shape"),
  );
  for (const el of candidates) {
    const label = (
      el.getAttribute("aria-label") ??
      el.textContent ??
      ""
    ).toLowerCase();
    if (phrases.some((p) => label.includes(p))) return el;
  }
  return null;
}

// --- Small DOM/util helpers ------------------------------------------------

/** Poll for matching elements until some appear or the timeout elapses. */
function waitForElements(
  selector: string,
  timeoutMs: number,
): Promise<HTMLElement[]> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const found = Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      );
      if (found.length > 0) return resolve(found);
      if (Date.now() - start >= timeoutMs) return resolve([]);
      setTimeout(tick, 150);
    };
    tick();
  });
}

/** "1:23" -> 83, "1:02:03" -> 3723. */
function parseTimestamp(stamp: string): number {
  const parts = stamp.split(":").map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function getVideoIdFromUrl(): string | null {
  return new URL(window.location.href).searchParams.get("v");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
