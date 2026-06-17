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

/** The title block we'd like to sit next to (may not exist yet on load). */
function findTitleAnchor(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "ytd-watch-metadata #title, #above-the-fold #title",
  );
}

function placeNearTitle(button: HTMLElement, anchor: HTMLElement): void {
  button.dataset.placement = "title";
  button.style.position = "";
  button.style.bottom = "";
  button.style.right = "";
  anchor.appendChild(button);
}

function placeFloating(button: HTMLElement): void {
  button.dataset.placement = "float";
  button.style.position = "fixed";
  button.style.bottom = "16px";
  button.style.right = "16px";
  button.style.zIndex = "9999";
  document.body.appendChild(button);
}

/**
 * Insert the button near the title when possible, otherwise float it. Because
 * the title block often renders after the content script runs, a button that
 * started floating is moved up to the title once it appears.
 */
function injectButton(): void {
  const existing = document.getElementById(BUTTON_ID);
  const anchor = findTitleAnchor();

  if (existing) {
    if (anchor && existing.dataset.placement === "float") {
      placeNearTitle(existing, anchor);
    }
    return;
  }

  const button = createButton();
  if (anchor) placeNearTitle(button, anchor);
  else placeFloating(button);
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
