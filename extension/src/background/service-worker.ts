// Service worker: owns the panel state, opens the side panel, and is the only
// context that talks to the backend. Content script and side panel communicate
// only through it.

import { BACKEND_URL } from "../shared/config";
import { isMessage, type Message, type PanelState } from "../shared/messages";
import type { ExtractRequest, ExtractResponse } from "../shared/types";

// v1 assumes one active recipe at a time, so a single state value is enough.
let currentState: PanelState = { status: "idle" };

function setState(state: PanelState): void {
  currentState = state;
  // Broadcast to the side panel. It may not be open yet; ignore "no receiver".
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", state } satisfies Message).catch(() => {});
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (!isMessage(raw)) return;

  switch (raw.type) {
    case "PANEL_OPEN":
      openPanel(sender.tab);
      setState({ status: "loading" });
      return;

    case "EXTRACT_REQUEST":
      setState({ status: "loading", title: raw.request.title });
      void runExtraction(raw.request);
      return;

    case "GATHER_ERROR":
      setState({ status: "error", code: raw.code, message: raw.message });
      return;

    case "GET_STATE":
      sendResponse(currentState);
      return; // synchronous response

    case "SEEK":
      void seekActiveTab(raw.seconds);
      return;
  }
});

function openPanel(tab?: chrome.tabs.Tab): void {
  if (!tab?.id) return;
  // Must run in the user-gesture turn that produced the message.
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
    console.error("[RecipeClip] could not open side panel:", err);
  });
}

async function runExtraction(request: ExtractRequest): Promise<void> {
  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    const data = (await res.json()) as ExtractResponse;

    if (data.ok) {
      setState({
        status: "ready",
        recipe: data.recipe,
        videoId: request.videoId,
        cached: data.cached,
      });
    } else {
      setState({ status: "error", code: data.error, message: data.message });
    }
  } catch {
    setState({
      status: "error",
      code: "internal_error",
      message: "Couldn't reach the RecipeClip backend. Is it running?",
    });
  }
}

async function seekActiveTab(seconds: number): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs
      .sendMessage(tab.id, { type: "SEEK", seconds } satisfies Message)
      .catch(() => {});
  }
}
