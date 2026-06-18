// Runs in the page's MAIN world. An isolated content script cannot read
// `window.ytInitialPlayerResponse` (page JS globals are walled off), so this
// tiny script is injected into the page on demand by transcript.ts and posts
// the player response back via window.postMessage.
//
// It is injected fresh on each request so it reflects the video currently open
// (YouTube is a single-page app and swaps videos without a full reload).

const MESSAGE_TAG = "recipeclip-page-reader";

(function emitPlayerResponse() {
  // Prefer the live player's response — it reflects the CURRENT video even after
  // YouTube's in-app (SPA) navigation. `window.ytInitialPlayerResponse` goes
  // stale after navigating to a new video without a full page reload.
  let playerResponse: unknown = null;
  try {
    const player = document.querySelector(
      "#movie_player, .html5-video-player",
    ) as { getPlayerResponse?: () => unknown } | null;
    if (player && typeof player.getPlayerResponse === "function") {
      playerResponse = player.getPlayerResponse();
    }
  } catch {
    // fall through to the global below
  }
  if (!playerResponse) {
    playerResponse =
      (window as unknown as { ytInitialPlayerResponse?: unknown })
        .ytInitialPlayerResponse ?? null;
  }

  window.postMessage(
    { __recipeclip: MESSAGE_TAG, playerResponse },
    window.location.origin,
  );
})();
