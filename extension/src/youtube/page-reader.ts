// Runs in the page's MAIN world. An isolated content script cannot read
// `window.ytInitialPlayerResponse` (page JS globals are walled off), so this
// tiny script is injected into the page on demand by transcript.ts and posts
// the player response back via window.postMessage.
//
// It is injected fresh on each request so it reflects the video currently open
// (YouTube is a single-page app and swaps videos without a full reload).

const MESSAGE_TAG = "recipeclip-page-reader";

(function emitPlayerResponse() {
  const w = window as unknown as { ytInitialPlayerResponse?: unknown };
  const playerResponse = w.ytInitialPlayerResponse ?? null;
  window.postMessage(
    { __recipeclip: MESSAGE_TAG, playerResponse },
    window.location.origin,
  );
})();
