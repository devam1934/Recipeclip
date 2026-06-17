// Side panel renderer. Subscribes to state owned by the service worker and
// draws the matching view: loading, error, or the recipe card. Editing, export,
// and saving are layered on in a later phase.

import { isMessage, type Message, type PanelState } from "../shared/messages";
import type { Recipe } from "../shared/types";

const app = document.getElementById("app")!;

// --- bootstrap: get current state, then listen for updates ----------------

chrome.runtime.sendMessage({ type: "GET_STATE" } satisfies Message).then(
  (state: PanelState | undefined) => render(state ?? { status: "idle" }),
  () => render({ status: "idle" }),
);

chrome.runtime.onMessage.addListener((raw) => {
  if (isMessage(raw) && raw.type === "STATE_UPDATE") render(raw.state);
});

// --- rendering -------------------------------------------------------------

function render(state: PanelState): void {
  app.replaceChildren(viewFor(state));
}

function viewFor(state: PanelState): Node {
  switch (state.status) {
    case "idle":
      return message("Open a YouTube recipe and click “Get recipe”.");
    case "loading":
      return loading(state.title);
    case "error":
      return message(state.message, "😕");
    case "ready":
      return recipeCard(state.recipe, state.videoId);
  }
}

function loading(title?: string): Node {
  const wrap = div("state");
  wrap.appendChild(div("spinner"));
  wrap.appendChild(text("p", title ? `Reading “${title}”…` : "Reading recipe…"));
  return wrap;
}

function message(msg: string, icon = "🍳"): Node {
  const wrap = div("state");
  wrap.appendChild(text("div", icon));
  wrap.appendChild(text("p", msg));
  return wrap;
}

function recipeCard(recipe: Recipe, videoId: string): Node {
  const frag = document.createDocumentFragment();

  frag.appendChild(text("h1", recipe.title));

  const meta: string[] = [];
  if (recipe.servings) meta.push(`Serves ${recipe.servings}`);
  if (recipe.totalTime) meta.push(recipe.totalTime);
  if (meta.length) frag.appendChild(text("div", meta.join(" · "), "meta"));

  const badge = text("span", confidenceLabel(recipe.sourceConfidence), "badge");
  badge.classList.add(recipe.sourceConfidence);
  frag.appendChild(badge);

  // Ingredients
  frag.appendChild(text("h2", "Ingredients"));
  const ul = document.createElement("ul");
  ul.className = "ingredients";
  for (const ing of recipe.ingredients) {
    const li = document.createElement("li");
    const qty = [ing.amount, ing.unit].filter(Boolean).join(" ");
    if (qty) li.appendChild(text("span", qty + " ", "amount"));
    li.appendChild(document.createTextNode(ing.name));
    if (ing.uncertain) li.appendChild(text("span", "approx", "uncertain"));
    ul.appendChild(li);
  }
  frag.appendChild(ul);

  // Steps
  frag.appendChild(text("h2", "Steps"));
  const ol = document.createElement("ol");
  ol.className = "steps";
  for (const step of recipe.steps) {
    const li = document.createElement("li");
    li.appendChild(document.createTextNode(step.instruction));
    if (step.timestamp !== null) {
      li.appendChild(timestampLink(step.timestamp, videoId));
    }
    ol.appendChild(li);
  }
  frag.appendChild(ol);

  if (recipe.notes) frag.appendChild(text("div", recipe.notes, "notes"));

  return frag;
}

/** Clickable timestamp: seeks the in-page video, with a normal link fallback. */
function timestampLink(seconds: number, videoId: string): HTMLElement {
  const link = document.createElement("a");
  link.className = "ts";
  link.textContent = formatTimestamp(seconds);
  link.href = `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`;
  link.target = "_blank";
  link.rel = "noopener";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: "SEEK", seconds } satisfies Message).catch(() => {});
  });
  return link;
}

// --- small helpers ---------------------------------------------------------

function confidenceLabel(c: Recipe["sourceConfidence"]): string {
  return `${c} confidence`;
}

function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function div(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function text(tag: string, content: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = content;
  if (className) el.className = className;
  return el;
}
