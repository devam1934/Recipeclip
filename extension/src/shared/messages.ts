// The message contract between the three extension contexts (content script,
// service worker, side panel). Keeping every message shape in one typed union
// makes the wiring easy to follow and hard to get wrong.

import type { ExtractErrorCode, ExtractRequest, Recipe } from "./types";

/** What the side panel is currently showing. The service worker owns this. */
export type PanelState =
  | { status: "idle" }
  | { status: "loading"; title?: string }
  | { status: "ready"; recipe: Recipe; videoId: string; cached: boolean }
  | { status: "error"; code: ExtractErrorCode; message: string };

export type Message =
  // content script -> service worker
  | { type: "PANEL_OPEN" } // user clicked the button; open panel + show loading
  | { type: "EXTRACT_REQUEST"; request: ExtractRequest }
  | { type: "GATHER_ERROR"; code: ExtractErrorCode; message: string }
  // side panel -> service worker
  | { type: "GET_STATE" }
  | { type: "SEEK"; seconds: number }
  // service worker -> side panel (broadcast)
  | { type: "STATE_UPDATE"; state: PanelState };

/** Narrowing helper for runtime message handlers. */
export function isMessage(value: unknown): value is Message {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
