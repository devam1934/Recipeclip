// Side panel renderer. Subscribes to state owned by the service worker and
// draws the matching view. The recipe card is editable in place: fields are
// contentEditable and rows can be added/removed. On copy/export/save we read
// the live DOM back into a Recipe (readRecipeFromDom), so we never have to sync
// on every keystroke.

import { isMessage, type Message, type PanelState } from "../shared/messages";
import type { Recipe, SourceConfidence } from "../shared/types";
import { formatTimestamp, toMarkdown } from "./export";
import { saveRecipe } from "./storage";

const app = document.getElementById("app")!;

// The video the current card belongs to — needed for deep-links and saving.
let currentVideoId: string | null = null;

// --- bootstrap -------------------------------------------------------------

chrome.runtime.sendMessage({ type: "GET_STATE" } satisfies Message).then(
  (state: PanelState | undefined) => render(state ?? { status: "idle" }),
  () => render({ status: "idle" }),
);

chrome.runtime.onMessage.addListener((raw) => {
  if (isMessage(raw) && raw.type === "STATE_UPDATE") render(raw.state);
});

// --- top-level rendering ---------------------------------------------------

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
      currentVideoId = state.videoId;
      return recipeCard(state.recipe);
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

// --- editable recipe card --------------------------------------------------

function recipeCard(recipe: Recipe): Node {
  const frag = document.createDocumentFragment();

  frag.appendChild(editable("h1", recipe.title, "r-title", "Recipe title"));

  const meta = div("meta");
  meta.append(
    document.createTextNode("Serves "),
    editable("span", recipe.servings ?? "", "r-servings", "?"),
    document.createTextNode(" · "),
    editable("span", recipe.totalTime ?? "", "r-totaltime", "total time"),
  );
  frag.appendChild(meta);

  const badge = text("span", `${recipe.sourceConfidence} confidence`, "badge");
  badge.classList.add(recipe.sourceConfidence);
  badge.dataset.confidence = recipe.sourceConfidence;
  frag.appendChild(badge);

  // Ingredients
  frag.appendChild(text("h2", "Ingredients"));
  const ul = document.createElement("ul");
  ul.className = "ingredients";
  ul.id = "ingredient-list";
  recipe.ingredients.forEach((ing) => ul.appendChild(ingredientRow(ing)));
  frag.appendChild(ul);
  frag.appendChild(
    addRowButton("+ ingredient", () =>
      ul.appendChild(ingredientRow({ name: "", amount: null, unit: null, uncertain: false })),
    ),
  );

  // Steps
  frag.appendChild(text("h2", "Steps"));
  const ol = document.createElement("ol");
  ol.className = "steps";
  ol.id = "step-list";
  recipe.steps.forEach((step) => ol.appendChild(stepRow(step.instruction, step.timestamp)));
  frag.appendChild(ol);
  frag.appendChild(
    addRowButton("+ step", () => ol.appendChild(stepRow("", null))),
  );

  // Notes
  frag.appendChild(text("h2", "Notes"));
  frag.appendChild(editable("div", recipe.notes ?? "", "r-notes notes", "Add notes…"));

  frag.appendChild(toolbar());
  frag.appendChild(text("div", "", "status"));

  return frag;
}

function ingredientRow(ing: Recipe["ingredients"][number]): HTMLElement {
  const li = document.createElement("li");
  li.className = "ing-row";
  li.append(
    editable("span", ing.amount ?? "", "ing-amount", "qty"),
    editable("span", ing.unit ?? "", "ing-unit", "unit"),
    editable("span", ing.name, "ing-name", "ingredient"),
    uncertainToggle(ing.uncertain),
    removeButton(li),
  );
  return li;
}

function stepRow(instruction: string, timestamp: number | null): HTMLElement {
  const li = document.createElement("li");
  li.className = "step-row";
  if (timestamp !== null) li.dataset.ts = String(timestamp);
  li.append(editable("span", instruction, "step-text", "step…"));
  if (timestamp !== null) li.append(timestampLink(timestamp));
  li.append(removeButton(li));
  return li;
}

/** A toggle chip; presence of the `.on` class is read back as `uncertain`. */
function uncertainToggle(on: boolean): HTMLElement {
  const chip = text("span", "approx", "uncertain");
  chip.title = "Toggle uncertain amount";
  chip.style.opacity = on ? "1" : "0.4";
  if (on) chip.classList.add("on");
  chip.addEventListener("click", () => {
    const nowOn = chip.classList.toggle("on");
    chip.style.opacity = nowOn ? "1" : "0.4";
  });
  return chip;
}

function timestampLink(seconds: number): HTMLElement {
  const link = document.createElement("a");
  link.className = "ts";
  link.textContent = formatTimestamp(seconds);
  if (currentVideoId) {
    link.href = `https://www.youtube.com/watch?v=${currentVideoId}&t=${seconds}s`;
  }
  link.target = "_blank";
  link.rel = "noopener";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: "SEEK", seconds } satisfies Message).catch(() => {});
  });
  return link;
}

function toolbar(): HTMLElement {
  const bar = div("toolbar");
  bar.append(
    actionButton("Copy", onCopy),
    actionButton("Export .md", onExport),
    actionButton("Save", onSave, true),
  );
  return bar;
}

// --- toolbar actions -------------------------------------------------------

async function onCopy(): Promise<void> {
  await navigator.clipboard.writeText(toMarkdown(readRecipeFromDom()));
  setStatus("Copied to clipboard.");
}

function onExport(): void {
  const recipe = readRecipeFromDom();
  const blob = new Blob([toMarkdown(recipe)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(recipe.title) || "recipe"}.md`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Markdown downloaded.");
}

async function onSave(): Promise<void> {
  if (!currentVideoId) return;
  await saveRecipe(currentVideoId, readRecipeFromDom());
  setStatus("Saved.");
}

// --- read the edited DOM back into a Recipe --------------------------------

function readRecipeFromDom(): Recipe {
  const ingredients = Array.from(
    document.querySelectorAll<HTMLElement>("#ingredient-list .ing-row"),
  )
    .map((row) => ({
      amount: readText(row.querySelector(".ing-amount")) || null,
      unit: readText(row.querySelector(".ing-unit")) || null,
      name: readText(row.querySelector(".ing-name")),
      uncertain: !!row.querySelector(".uncertain.on"),
    }))
    .filter((i) => i.name !== "");

  const steps = Array.from(
    document.querySelectorAll<HTMLElement>("#step-list .step-row"),
  )
    .map((row) => ({
      instruction: readText(row.querySelector(".step-text")),
      timestamp: row.dataset.ts !== undefined ? Number(row.dataset.ts) : null,
    }))
    .filter((s) => s.instruction !== "");

  const badge = document.querySelector<HTMLElement>(".badge");

  return {
    title: readText(document.querySelector(".r-title")) || "Untitled recipe",
    servings: readText(document.querySelector(".r-servings")) || null,
    totalTime: readText(document.querySelector(".r-totaltime")) || null,
    ingredients,
    steps,
    notes: readText(document.querySelector(".r-notes")) || null,
    sourceConfidence: (badge?.dataset.confidence as SourceConfidence) ?? "low",
    isRecipe: true,
  };
}

// --- small DOM helpers -----------------------------------------------------

function editable(
  tag: string,
  content: string,
  className: string,
  placeholder: string,
): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  el.contentEditable = "true";
  el.dataset.placeholder = placeholder;
  return el;
}

function addRowButton(label: string, onClick: () => void): HTMLElement {
  const btn = text("button", label, "add-row");
  btn.addEventListener("click", onClick);
  return btn;
}

function removeButton(row: HTMLElement): HTMLElement {
  const btn = text("button", "✕", "row-remove");
  btn.title = "Remove";
  btn.addEventListener("click", () => row.remove());
  return btn;
}

function actionButton(
  label: string,
  onClick: () => void | Promise<void>,
  primary = false,
): HTMLElement {
  const btn = text("button", label, "action");
  if (primary) btn.classList.add("primary");
  btn.addEventListener("click", () => void onClick());
  return btn;
}

function setStatus(msg: string): void {
  const status = document.querySelector<HTMLElement>(".status");
  if (status) status.textContent = msg;
}

function readText(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
