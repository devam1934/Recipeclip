// Content script. Two jobs:
//   1. Put a "Get recipe" button on the watch page and, on click, gather the
//      video data (via the quarantined transcript module) and hand it off.
//   2. Seek the video when the side panel asks (timestamp deep-links).
//
// All the brittle YouTube logic stays in ../youtube/transcript. This file only
// deals with placing one button and talking to the service worker.

import { isMessage, type Message } from "../shared/messages";
import {
  gatherVideoData,
  NoTranscriptError,
  NotAVideoError,
} from "../youtube/transcript";

const BUTTON_ID = "recipeclip-get-recipe";

function send(message: Message): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.textContent = "🍳 Get recipe";
  button.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:6px",
    "margin:8px 0",
    "padding:8px 14px",
    "font:500 14px/1 Roboto, Arial, sans-serif",
    "color:#0f0f0f",
    "background:#ff5722",
    "color:#fff",
    "border:none",
    "border-radius:18px",
    "cursor:pointer",
  ].join(";");
  button.addEventListener("click", onClick);
  return button;
}

async function onClick(event: Event): Promise<void> {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Reading…";

  // Open the panel within the user-gesture turn, before any async work.
  send({ type: "PANEL_OPEN" });

  try {
    const request = await gatherVideoData();
    send({ type: "EXTRACT_REQUEST", request });
  } catch (err) {
    if (err instanceof NoTranscriptError) {
      send({ type: "GATHER_ERROR", code: "no_transcript", message: err.message });
    } else if (err instanceof NotAVideoError) {
      send({ type: "GATHER_ERROR", code: "bad_request", message: err.message });
    } else {
      send({
        type: "GATHER_ERROR",
        code: "internal_error",
        message: "Couldn't read the video data.",
      });
    }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

/** Insert the button near the video title, if it isn't already present. */
function injectButton(): void {
  if (document.getElementById(BUTTON_ID)) return;
  // Anchor next to the title block; fall back to a floating button.
  const anchor =
    document.querySelector("ytd-watch-metadata #title") ??
    document.querySelector("#above-the-fold #title");
  const button = createButton();

  if (anchor) {
    anchor.parentElement?.insertBefore(button, anchor);
  } else {
    button.style.position = "fixed";
    button.style.bottom = "16px";
    button.style.right = "16px";
    button.style.zIndex = "9999";
    document.body.appendChild(button);
  }
}

/** Seek the page's video element to a given second. */
function seekTo(seconds: number): void {
  const video = document.querySelector<HTMLVideoElement>("video");
  if (!video) return;
  video.currentTime = seconds;
  void video.play().catch(() => {});
  video.scrollIntoView({ behavior: "smooth", block: "center" });
}

chrome.runtime.onMessage.addListener((raw) => {
  if (isMessage(raw) && raw.type === "SEEK") seekTo(raw.seconds);
});

// YouTube is a SPA: re-inject after in-app navigation and after late renders.
document.addEventListener("yt-navigate-finish", () => injectButton());
const observer = new MutationObserver(() => injectButton());
observer.observe(document.documentElement, { childList: true, subtree: true });
injectButton();
