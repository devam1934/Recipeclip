// Side panel renderer.
//
// The card is "view-first": a clean, scannable read-only view by default, with
// an Edit toggle that turns fields into editable inputs. View mode adds the
// cooking affordances — tick-off checklists (persisted per video), a servings
// scaler, and collapsible sections. The service worker owns the fetch/loading
// state; everything below is local UI state.

import { isMessage, type Message, type PanelState } from "../shared/messages";
import type { Recipe } from "../shared/types";
import { formatTimestamp, toMarkdown } from "./export";
import { scaleAmount, scaleServings } from "./scale";
import { loadChecks, saveChecks, saveRecipe, type Checks } from "./storage";

const app = document.getElementById("app")!;

// --- local UI state --------------------------------------------------------

let recipe: Recipe | null = null;
let videoId: string | null = null;
let editMode = false;
let scale = 1;
const collapsed = { ingredients: false, steps: false };
const checkedIngredients = new Set<number>();
const checkedSteps = new Set<number>();

// --- bootstrap -------------------------------------------------------------

chrome.runtime.sendMessage({ type: "GET_STATE" } satisfies Message).then(
  (state: PanelState | undefined) => handleState(state ?? { status: "idle" }),
  () => handleState({ status: "idle" }),
);

chrome.runtime.onMessage.addListener((raw) => {
  if (isMessage(raw) && raw.type === "STATE_UPDATE") handleState(raw.state);
});

function handleState(state: PanelState): void {
  if (state.status !== "ready") {
    recipe = null;
    app.replaceChildren(nonReadyView(state));
    return;
  }

  // New recipe: reset all local view state.
  recipe = structuredClone(state.recipe);
  videoId = state.videoId;
  editMode = false;
  scale = 1;
  collapsed.ingredients = false;
  collapsed.steps = false;
  checkedIngredients.clear();
  checkedSteps.clear();
  renderCard();

  // Restore any ticked-off items for this video.
  void loadChecks(state.videoId).then((checks) => {
    checks.ingredients.forEach((i) => checkedIngredients.add(i));
    checks.steps.forEach((i) => checkedSteps.add(i));
    if (recipe) renderCard();
  });
}

function nonReadyView(state: PanelState): Node {
  switch (state.status) {
    case "loading": {
      const wrap = el("div", "state");
      wrap.appendChild(el("div", "spinner"));
      wrap.appendChild(textEl("p", state.title ? `Reading “${state.title}”…` : "Reading recipe…"));
      return wrap;
    }
    case "error":
      return message(state.message, "😕");
    case "idle":
    default:
      return message("Open a YouTube recipe and click “Get recipe”.", "🍳");
  }
}

function message(msg: string, icon: string): Node {
  const wrap = el("div", "state");
  wrap.appendChild(textEl("div", icon, "icon"));
  wrap.appendChild(textEl("p", msg));
  return wrap;
}

// --- the card --------------------------------------------------------------

function renderCard(): void {
  if (!recipe) return;
  app.replaceChildren(card(recipe));
}

function card(r: Recipe): DocumentFragment {
  const frag = document.createDocumentFragment();

  // Title + confidence
  const top = el("div", "top");
  const title = textEl("h1", r.title, "title");
  if (editMode) makeEditable(title, "r-title", "Recipe title");
  top.appendChild(title);
  const conf = textEl("span", `${r.sourceConfidence}`, "conf");
  conf.classList.add(r.sourceConfidence);
  top.appendChild(conf);
  frag.appendChild(top);

  // Chips (serves / time)
  frag.appendChild(chips(r));

  // Servings scaler (view mode only)
  if (!editMode) frag.appendChild(scaleRow());

  // Control bar (view/edit toggle + actions)
  frag.appendChild(controlBar());

  // Sections
  frag.appendChild(
    section("Ingredients", "ingredients", `${r.ingredients.length} items`, ingredientsBody(r)),
  );
  frag.appendChild(
    section("Steps", "steps", `${r.steps.length} steps`, stepsBody(r)),
  );

  // Notes
  if (editMode) {
    frag.appendChild(textEl("h2", "Notes", "section-head"));
    const notes = textEl("div", r.notes ?? "", "notes");
    makeEditable(notes, "r-notes", "Add notes…");
    frag.appendChild(notes);
  } else if (r.notes) {
    frag.appendChild(textEl("div", r.notes, "notes"));
  }

  frag.appendChild(textEl("div", "", "status"));
  return frag;
}

function chips(r: Recipe): HTMLElement {
  const wrap = el("div", "chips");

  const serves = el("span", "chip");
  serves.appendChild(document.createTextNode("🍽 "));
  if (editMode) {
    serves.appendChild(document.createTextNode("Serves "));
    serves.appendChild(makeEditable(textEl("span", r.servings ?? ""), "r-servings", "?"));
  } else {
    serves.appendChild(document.createTextNode(`Serves ${scaleServings(r.servings, scale) ?? "?"}`));
  }
  wrap.appendChild(serves);

  const time = el("span", "chip");
  time.appendChild(document.createTextNode("⏱ "));
  if (editMode) {
    time.appendChild(makeEditable(textEl("span", r.totalTime ?? ""), "r-totaltime", "total time"));
  } else if (r.totalTime) {
    time.appendChild(document.createTextNode(r.totalTime));
  } else {
    return wrap; // no time chip if unknown and not editing
  }
  wrap.appendChild(time);
  return wrap;
}

function scaleRow(): HTMLElement {
  const wrap = el("div", "scale");
  wrap.appendChild(textEl("span", "Scale", "lbl"));
  const seg = el("div", "seg");
  for (const factor of [0.5, 1, 2]) {
    const btn = textEl("button", factor === 1 ? "1×" : factor === 0.5 ? "½×" : "2×");
    if (factor === scale) btn.classList.add("on");
    btn.addEventListener("click", () => {
      scale = factor;
      renderCard();
    });
    seg.appendChild(btn);
  }
  wrap.appendChild(seg);
  return wrap;
}

function controlBar(): HTMLElement {
  const bar = el("div", "bar");

  const seg = el("div", "seg");
  const viewBtn = textEl("button", "View");
  const editBtn = textEl("button", "Edit");
  (editMode ? editBtn : viewBtn).classList.add("on");
  viewBtn.addEventListener("click", () => setEditMode(false));
  editBtn.addEventListener("click", () => setEditMode(true));
  seg.append(viewBtn, editBtn);
  bar.appendChild(seg);

  const actions = el("div", "actions");
  actions.append(
    actionBtn("Copy", onCopy),
    actionBtn("Export", onExport),
    actionBtn("Save", onSave),
  );
  bar.appendChild(actions);
  return bar;
}

function section(
  title: string,
  key: "ingredients" | "steps",
  count: string,
  body: HTMLElement,
): HTMLElement {
  const wrap = el("div", "section");
  const head = el("div", "section-head");
  if (collapsed[key]) head.classList.add("collapsed");
  head.append(
    textEl("span", "▾", "caret"),
    textEl("h2", title),
    textEl("span", count, "count"),
  );
  head.addEventListener("click", () => {
    collapsed[key] = !collapsed[key];
    renderCard();
  });
  wrap.appendChild(head);
  if (!collapsed[key]) wrap.appendChild(body);
  return wrap;
}

function ingredientsBody(r: Recipe): HTMLElement {
  const wrap = el("div");

  r.ingredients.forEach((ing, i) => {
    const row = el("div", "row");

    if (editMode) {
      const edit = el("div", "ing-edit");
      edit.append(
        makeEditable(textEl("span", ing.amount ?? "", "ing-amount"), undefined, "qty"),
        makeEditable(textEl("span", ing.unit ?? "", "ing-unit"), undefined, "unit"),
        makeEditable(textEl("span", ing.name, "ing-name"), undefined, "ingredient"),
      );
      row.append(edit, uncertainToggle(ing.uncertain), removeButton(row));
    } else {
      if (checkedIngredients.has(i)) row.classList.add("done");
      const check = textEl("span", "✓", "check");
      check.addEventListener("click", () => toggleCheck(row, check, checkedIngredients, i));
      const text = el("span", "text");
      const qty = [scaleAmount(ing.amount, scale), ing.unit].filter(Boolean).join(" ");
      if (qty) text.appendChild(textEl("span", qty + " ", "amount"));
      text.appendChild(document.createTextNode(ing.name));
      if (ing.uncertain) text.appendChild(textEl("span", "approx", "tag"));
      row.append(check, text);
    }
    wrap.appendChild(row);
  });

  if (editMode) {
    wrap.appendChild(addRow("+ ingredient", () => {
      recipe?.ingredients.push({ name: "", amount: null, unit: null, uncertain: false });
      readDomIntoRecipe();
      renderCard();
    }));
  }
  return wrap;
}

function stepsBody(r: Recipe): HTMLElement {
  const wrap = el("div");

  r.steps.forEach((step, i) => {
    const row = el("div", "row");
    if (step.timestamp !== null) row.dataset.ts = String(step.timestamp);

    if (editMode) {
      row.append(
        textEl("span", String(i + 1), "num"),
        makeEditable(textEl("div", step.instruction, "step-text text"), undefined, "step…"),
        removeButton(row),
      );
    } else {
      if (checkedSteps.has(i)) row.classList.add("done");
      const num = textEl("span", checkedSteps.has(i) ? "✓" : String(i + 1), "num");
      num.addEventListener("click", () => {
        const on = toggleCheck(row, null, checkedSteps, i);
        num.textContent = on ? "✓" : String(i + 1);
      });
      const col = el("div", "text");
      col.appendChild(textEl("div", step.instruction));
      if (step.timestamp !== null) col.appendChild(timestampPill(step.timestamp));
      row.append(num, col);
    }
    wrap.appendChild(row);
  });

  if (editMode) {
    wrap.appendChild(addRow("+ step", () => {
      recipe?.steps.push({ instruction: "", timestamp: null });
      readDomIntoRecipe();
      renderCard();
    }));
  }
  return wrap;
}

// --- interactions ----------------------------------------------------------

function setEditMode(on: boolean): void {
  if (on === editMode) return;
  if (!on) readDomIntoRecipe(); // leaving edit: capture changes
  editMode = on;
  renderCard();
}

/** Toggle a checklist item; persist; return the new checked state. */
function toggleCheck(
  row: HTMLElement,
  check: HTMLElement | null,
  set: Set<number>,
  index: number,
): boolean {
  const now = !set.has(index);
  if (now) set.add(index);
  else set.delete(index);
  row.classList.toggle("done", now);
  void check; // styling handled via the row's .done class
  persistChecks();
  return now;
}

function persistChecks(): void {
  if (!videoId) return;
  const checks: Checks = {
    ingredients: [...checkedIngredients],
    steps: [...checkedSteps],
  };
  void saveChecks(videoId, checks);
}

function timestampPill(seconds: number): HTMLElement {
  const pill = textEl("button", `▶ ${formatTimestamp(seconds)}`, "ts");
  pill.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "SEEK", seconds } satisfies Message).catch(() => {});
  });
  return pill;
}

// --- toolbar actions -------------------------------------------------------

async function onCopy(): Promise<void> {
  await navigator.clipboard.writeText(toMarkdown(effectiveRecipe()));
  setStatus("Copied to clipboard.");
}

function onExport(): void {
  const r = effectiveRecipe();
  const blob = new Blob([toMarkdown(r)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(r.title) || "recipe"}.md`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Markdown downloaded.");
}

async function onSave(): Promise<void> {
  if (!videoId || !recipe) return;
  if (editMode) readDomIntoRecipe();
  await saveRecipe(videoId, recipe); // save the base (unscaled) recipe
  setStatus("Saved.");
}

/** The recipe as currently shown: edits captured, scaling applied. */
function effectiveRecipe(): Recipe {
  if (editMode) readDomIntoRecipe();
  const base = recipe!;
  return {
    ...base,
    servings: scaleServings(base.servings, scale),
    ingredients: base.ingredients.map((ing) => ({
      ...ing,
      amount: scaleAmount(ing.amount, scale),
    })),
  };
}

// --- read edited DOM back into `recipe` ------------------------------------

function readDomIntoRecipe(): void {
  if (!recipe) return;

  const ingredients = Array.from(app.querySelectorAll<HTMLElement>(".ing-edit"))
    .map((edit) => ({
      amount: readText(edit.querySelector(".ing-amount")) || null,
      unit: readText(edit.querySelector(".ing-unit")) || null,
      name: readText(edit.querySelector(".ing-name")),
      uncertain: !!edit.parentElement?.querySelector(".uncertain.on"),
    }))
    .filter((i) => i.name !== "");

  const steps = Array.from(app.querySelectorAll<HTMLElement>(".row"))
    .filter((row) => row.querySelector(".step-text"))
    .map((row) => ({
      instruction: readText(row.querySelector(".step-text")),
      timestamp: row.dataset.ts !== undefined ? Number(row.dataset.ts) : null,
    }))
    .filter((s) => s.instruction !== "");

  recipe = {
    ...recipe,
    title: readText(app.querySelector(".r-title")) || recipe.title,
    servings: readText(app.querySelector(".r-servings")) || null,
    totalTime: readText(app.querySelector(".r-totaltime")) || null,
    notes: readText(app.querySelector(".r-notes")) || null,
    ingredients: ingredients.length ? ingredients : recipe.ingredients,
    steps: steps.length ? steps : recipe.steps,
  };
}

// --- small DOM helpers -----------------------------------------------------

function uncertainToggle(on: boolean): HTMLElement {
  const chip = textEl("span", "approx", "uncertain tag");
  chip.title = "Toggle uncertain amount";
  chip.style.opacity = on ? "1" : "0.4";
  if (on) chip.classList.add("on");
  chip.addEventListener("click", () => {
    chip.style.opacity = chip.classList.toggle("on") ? "1" : "0.4";
  });
  return chip;
}

function removeButton(row: HTMLElement): HTMLElement {
  const btn = textEl("button", "✕", "row-remove");
  btn.title = "Remove";
  btn.addEventListener("click", () => {
    row.remove();
    readDomIntoRecipe();
  });
  return btn;
}

function addRow(label: string, onClick: () => void): HTMLElement {
  const btn = textEl("button", label, "add-row");
  btn.addEventListener("click", onClick);
  return btn;
}

function actionBtn(label: string, onClick: () => void | Promise<void>): HTMLElement {
  const btn = textEl("button", label, "icon-btn");
  btn.addEventListener("click", () => void onClick());
  return btn;
}

function makeEditable(elm: HTMLElement, className: string | undefined, placeholder: string): HTMLElement {
  if (className) elm.classList.add(...className.split(" "));
  elm.contentEditable = "true";
  elm.dataset.ph = placeholder;
  return elm;
}

function setStatus(msg: string): void {
  const status = app.querySelector<HTMLElement>(".status");
  if (status) status.textContent = msg;
}

function readText(elm: Element | null): string {
  return elm?.textContent?.trim() ?? "";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function textEl(tag: string, content: string, className?: string): HTMLElement {
  const e = el(tag, className);
  e.textContent = content;
  return e;
}
