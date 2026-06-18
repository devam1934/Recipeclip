// Side panel renderer.
//
// The card is "view-first": a clean, scannable read-only view by default, with
// an Edit toggle that turns fields into editable inputs. View mode adds the
// cooking affordances — tick-off checklists (persisted per video), a servings
// scaler, and collapsible sections. The service worker owns the fetch/loading
// state; everything below is local UI state.

import { SUBSTITUTE_URL } from "../shared/config";
import { isMessage, type Message, type PanelState } from "../shared/messages";
import type { Nutrition, Recipe, SubstituteResponse } from "../shared/types";
import { formatTimestamp, toMarkdown } from "./export";
import { scaleServings } from "./scale";
import { convertInText, convertMeasure, type UnitSystem } from "./units";
import {
  deleteRecipe,
  listSavedRecipes,
  loadChecks,
  saveChecks,
  saveRecipe,
  type Checks,
  type SavedEntry,
} from "./storage";

const app = document.getElementById("app")!;

// --- local UI state --------------------------------------------------------

let recipe: Recipe | null = null;
let videoId: string | null = null;
let editMode = false;
let scale = 1;
let units: UnitSystem = "orig";
let activeTab: Tab = "ingredients";
let libraryOpen = false;
let lastState: PanelState = { status: "idle" };
const checkedIngredients = new Set<number>();
const checkedSteps = new Set<number>();

type Tab = "ingredients" | "steps" | "overview";

// --- bootstrap -------------------------------------------------------------

chrome.runtime.sendMessage({ type: "GET_STATE" } satisfies Message).then(
  (state: PanelState | undefined) => handleState(state ?? { status: "idle" }),
  () => handleState({ status: "idle" }),
);

chrome.runtime.onMessage.addListener((raw) => {
  if (isMessage(raw) && raw.type === "STATE_UPDATE") handleState(raw.state);
});

function handleState(state: PanelState): void {
  lastState = state;
  libraryOpen = false; // any SW update returns us to the live view

  if (state.status !== "ready") {
    recipe = null;
    renderRoot();
    return;
  }

  loadRecipeIntoView(structuredClone(state.recipe), state.videoId);
}

/** Load a recipe (from the backend or the library) into the card view. */
function loadRecipeIntoView(r: Recipe, id: string): void {
  recipe = r;
  videoId = id;
  editMode = false;
  scale = 1;
  units = "orig";
  activeTab = "ingredients";
  checkedIngredients.clear();
  checkedSteps.clear();
  lastState = { status: "ready", recipe: r, videoId: id, cached: true };
  renderRoot();

  // Restore any ticked-off items for this video.
  void loadChecks(id).then((checks) => {
    checks.ingredients.forEach((i) => checkedIngredients.add(i));
    checks.steps.forEach((i) => checkedSteps.add(i));
    if (recipe && !libraryOpen) renderRoot();
  });
}

/** Single render entry point: library overlay, the card, or a status view. */
function renderRoot(): void {
  if (libraryOpen) {
    app.replaceChildren(libraryView());
  } else if (lastState.status === "ready" && recipe) {
    app.replaceChildren(card(recipe));
  } else {
    app.replaceChildren(nonReadyView(lastState));
  }
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
    default: {
      const wrap = message("Open a YouTube recipe and click “Get recipe”.", "🍳");
      const btn = textEl("button", "Saved recipes", "icon-btn");
      btn.style.marginTop = "12px";
      btn.addEventListener("click", openLibrary);
      wrap.appendChild(btn);
      return wrap;
    }
  }
}

function message(msg: string, icon: string): Node {
  const wrap = el("div", "state");
  wrap.appendChild(textEl("div", icon, "icon"));
  wrap.appendChild(textEl("p", msg));
  return wrap;
}

// --- saved-recipes library -------------------------------------------------

function libraryView(): HTMLElement {
  const wrap = el("div", "library");

  const head = el("div", "lib-head");
  const back = textEl("button", "← Back", "icon-btn");
  back.addEventListener("click", () => {
    libraryOpen = false;
    renderRoot();
  });
  head.append(back, textEl("h1", "Saved recipes", "title"));
  wrap.appendChild(head);

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search saved recipes…";
  search.className = "lib-search";
  wrap.appendChild(search);

  const list = el("div", "lib-list");
  wrap.appendChild(list);

  // Filter by title without re-rendering (keeps input focus).
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll<HTMLElement>(".lib-item").forEach((item) => {
      item.style.display = (item.dataset.title ?? "").includes(q) ? "" : "none";
    });
  });

  void listSavedRecipes().then((entries) => {
    if (entries.length === 0) {
      list.appendChild(textEl("p", "No saved recipes yet.", "summary"));
      return;
    }
    for (const entry of entries) list.appendChild(libraryItem(entry));
  });

  return wrap;
}

function libraryItem(entry: SavedEntry): HTMLElement {
  const item = el("div", "lib-item");
  item.dataset.title = (entry.recipe.title ?? "").toLowerCase();

  const main = el("div", "lib-main");
  main.appendChild(textEl("div", entry.recipe.title || "Untitled", "lib-title"));
  const meta: string[] = [];
  if (entry.recipe.cuisine) meta.push(entry.recipe.cuisine);
  const tags = entry.recipe.dietaryTags ?? [];
  if (tags.length) meta.push(tags.slice(0, 2).join(", "));
  meta.push(formatDate(entry.savedAt));
  main.appendChild(textEl("div", meta.filter(Boolean).join(" · "), "lib-meta"));
  main.addEventListener("click", () => openSaved(entry));
  item.appendChild(main);

  const del = textEl("button", "✕", "row-remove");
  del.title = "Delete";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    void deleteRecipe(entry.videoId).then(() => item.remove());
  });
  item.appendChild(del);
  return item;
}

function openSaved(entry: SavedEntry): void {
  loadRecipeIntoView(structuredClone(entry.recipe), entry.videoId);
}

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString();
}

// --- nutrition ring --------------------------------------------------------

const MACRO_COLORS = { protein: "#3b82f6", carbs: "#f59e0b", fat: "#ef4444" };

function nutritionRing(n: Nutrition): HTMLElement {
  const p = n.protein ?? 0;
  const c = n.carbs ?? 0;
  const f = n.fat ?? 0;
  const cals = { protein: p * 4, carbs: c * 4, fat: f * 9 };
  const total = cals.protein + cals.carbs + cals.fat;
  const kcal = n.calories ?? (total > 0 ? Math.round(total) : null);

  const size = 76;
  const cx = size / 2;
  const r = 28;
  const circ = 2 * Math.PI * r;

  const svg = svg_("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  svg.appendChild(svg_("circle", { cx, cy: cx, r, fill: "none", stroke: "var(--line)", "stroke-width": 8 }));

  if (total > 0) {
    let offset = 0;
    for (const key of ["protein", "carbs", "fat"] as const) {
      const len = (cals[key] / total) * circ;
      if (len <= 0) continue;
      svg.appendChild(svg_("circle", {
        cx, cy: cx, r, fill: "none",
        stroke: MACRO_COLORS[key], "stroke-width": 8,
        "stroke-dasharray": `${len} ${circ - len}`,
        "stroke-dashoffset": `${-offset}`,
        transform: `rotate(-90 ${cx} ${cx})`,
      }));
      offset += len;
    }
  }

  if (kcal !== null) {
    const t = svg_("text", { x: cx, y: cx - 1, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 14, "font-weight": 600, fill: "var(--fg)" });
    t.textContent = String(kcal);
    svg.appendChild(t);
    const u = svg_("text", { x: cx, y: cx + 12, "text-anchor": "middle", "font-size": 8, fill: "var(--muted)" });
    u.textContent = "kcal";
    svg.appendChild(u);
  }

  const row = el("div", "nutri-row");
  row.appendChild(svg);
  const legend = el("div", "nutri-legend");
  legend.append(
    macroLegend("Protein", n.protein, MACRO_COLORS.protein),
    macroLegend("Carbs", n.carbs, MACRO_COLORS.carbs),
    macroLegend("Fat", n.fat, MACRO_COLORS.fat),
  );
  row.appendChild(legend);
  return row;
}

function macroLegend(label: string, grams: number | null, color: string): HTMLElement {
  const item = el("div", "nutri-item");
  const dot = el("span", "nutri-dot");
  dot.style.background = color;
  item.append(dot, document.createTextNode(`${label}: ${grams === null ? "—" : `${grams} g`}`));
  return item;
}

function svg_(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// --- the card --------------------------------------------------------------

function renderCard(): void {
  renderRoot();
}

function card(r: Recipe): DocumentFragment {
  const frag = document.createDocumentFragment();

  // --- sticky header: stays put while a tab's list scrolls ---
  const head = el("div", "head");

  const nav = el("div", "nav");
  const savedBtn = textEl("button", "☰ Saved recipes", "icon-btn");
  savedBtn.addEventListener("click", openLibrary);
  nav.appendChild(savedBtn);
  head.appendChild(nav);

  const top = el("div", "top");
  const title = textEl("h1", r.title, "title");
  if (editMode) makeEditable(title, "r-title", "Recipe title");
  top.appendChild(title);
  const conf = textEl("span", `${r.sourceConfidence}`, "conf");
  conf.classList.add(r.sourceConfidence);
  top.appendChild(conf);
  head.appendChild(top);

  head.appendChild(chips(r));

  const pills = dietaryPills(r);
  if (pills) head.appendChild(pills);

  if (!editMode) head.appendChild(controlsRow());
  head.appendChild(controlBar());
  head.appendChild(tabBar(r));
  frag.appendChild(head);

  // --- active tab body ---
  frag.appendChild(tabBody(r));
  frag.appendChild(textEl("div", "", "status"));
  return frag;
}

function dietaryPills(r: Recipe): HTMLElement | null {
  const tags = r.dietaryTags ?? [];
  if (tags.length === 0) return null;
  const wrap = el("div", "pills");
  for (const tag of tags) wrap.appendChild(textEl("span", tag, "pill"));
  return wrap;
}

function tabBar(r: Recipe): HTMLElement {
  const bar = el("div", "tabbar");
  const tabs: [Tab, string][] = [
    ["ingredients", `Ingredients · ${r.ingredients.length}`],
    ["steps", `Steps · ${r.steps.length}`],
    ["overview", "Overview"],
  ];
  for (const [key, label] of tabs) {
    const tab = textEl("button", label, "tab");
    if (key === activeTab) tab.classList.add("on");
    tab.addEventListener("click", () => {
      if (editMode) readDomIntoRecipe(); // keep edits from the current tab
      activeTab = key;
      renderCard();
    });
    bar.appendChild(tab);
  }
  return bar;
}

function tabBody(r: Recipe): HTMLElement {
  const body = el("div", "tabbody");
  if (activeTab === "ingredients") body.appendChild(ingredientsBody(r));
  else if (activeTab === "steps") body.appendChild(stepsBody(r));
  else body.appendChild(overviewBody(r));
  return body;
}

function overviewBody(r: Recipe): HTMLElement {
  const wrap = el("div");

  if (editMode) {
    wrap.appendChild(textEl("div", "Summary", "ov-label"));
    const summary = textEl("div", r.summary ?? "", "notes");
    makeEditable(summary, "r-summary", "Short summary…");
    wrap.appendChild(summary);
  } else if (r.summary) {
    wrap.appendChild(textEl("p", r.summary, "summary"));
  }

  if (!editMode && r.backstory) {
    wrap.appendChild(textEl("div", "Origin", "ov-label"));
    wrap.appendChild(textEl("p", r.backstory, "summary"));
  }

  if (!editMode && r.chefTip) {
    wrap.appendChild(textEl("div", "Chef's tip", "ov-label"));
    wrap.appendChild(textEl("p", r.chefTip, "summary"));
  }

  const facts: string[] = [];
  if (r.difficulty) facts.push(`Difficulty: ${r.difficulty}`);
  if (r.cuisine) facts.push(`Cuisine: ${r.cuisine}`);
  if (facts.length) wrap.appendChild(textEl("div", facts.join("  ·  "), "ov-facts"));

  if (!editMode && r.nutrition) {
    wrap.appendChild(textEl("div", "Nutrition · estimate, per serving", "ov-label"));
    wrap.appendChild(nutritionRing(r.nutrition));
  }

  const equipment = r.equipment ?? [];
  if (equipment.length) {
    wrap.appendChild(textEl("div", "Equipment", "ov-label"));
    const list = el("div", "pills");
    for (const item of equipment) list.appendChild(textEl("span", item, "pill"));
    wrap.appendChild(list);
  }

  if (editMode) {
    wrap.appendChild(textEl("div", "Notes", "ov-label"));
    const notes = textEl("div", r.notes ?? "", "notes");
    makeEditable(notes, "r-notes", "Add notes…");
    wrap.appendChild(notes);
  } else if (r.notes) {
    wrap.appendChild(textEl("div", "Notes", "ov-label"));
    wrap.appendChild(textEl("div", r.notes, "notes"));
  }

  if (!wrap.hasChildNodes()) {
    wrap.appendChild(textEl("p", "No extra details for this recipe.", "summary"));
  }
  return wrap;
}

function chips(r: Recipe): HTMLElement {
  const wrap = el("div", "chips");

  if (editMode) {
    // In edit mode show both fields (editable) even when empty.
    const serves = el("span", "chip");
    serves.append(
      document.createTextNode("🍽 Serves "),
      makeEditable(textEl("span", r.servings ?? ""), "r-servings", "?"),
    );
    const time = el("span", "chip");
    time.append(
      document.createTextNode("⏱ "),
      makeEditable(textEl("span", r.totalTime ?? ""), "r-totaltime", "total time"),
    );
    wrap.append(serves, time);
    return wrap;
  }

  // View mode: only show a chip when we actually have the value (no "Serves ?").
  if (r.servings) {
    wrap.appendChild(textEl("span", `🍽 Serves ${scaleServings(r.servings, scale)}`, "chip"));
  }
  if (r.totalTime) {
    wrap.appendChild(textEl("span", `⏱ ${r.totalTime}`, "chip"));
  }
  return wrap;
}

function controlsRow(): HTMLElement {
  const wrap = el("div", "controls");

  const scaleCtl = el("div", "ctl");
  scaleCtl.appendChild(textEl("span", "Scale", "lbl"));
  const scaleSeg = el("div", "seg accent");
  for (const factor of [0.5, 1, 2]) {
    const btn = textEl("button", factor === 1 ? "1×" : factor === 0.5 ? "½×" : "2×");
    if (factor === scale) btn.classList.add("on");
    btn.addEventListener("click", () => {
      scale = factor;
      renderCard();
    });
    scaleSeg.appendChild(btn);
  }
  scaleCtl.appendChild(scaleSeg);
  wrap.appendChild(scaleCtl);

  const unitCtl = el("div", "ctl");
  unitCtl.appendChild(textEl("span", "Units", "lbl"));
  const unitSeg = el("div", "seg accent");
  const opts: [UnitSystem, string][] = [["orig", "Orig"], ["us", "US"], ["metric", "Metric"]];
  for (const [sys, label] of opts) {
    const btn = textEl("button", label);
    if (sys === units) btn.classList.add("on");
    btn.addEventListener("click", () => {
      units = sys;
      renderCard();
    });
    unitSeg.appendChild(btn);
  }
  unitCtl.appendChild(unitSeg);
  wrap.appendChild(unitCtl);

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

function openLibrary(): void {
  libraryOpen = true;
  renderRoot();
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
      row.classList.add("ing-col");
      const line = el("div", "ing-line");
      const check = textEl("span", "✓", "check");
      check.addEventListener("click", () => toggleCheck(row, check, checkedIngredients, i));
      const text = el("span", "text");
      const m = convertMeasure(ing.amount, ing.unit, units, scale);
      const qty = [m.amount, m.unit].filter(Boolean).join(" ");
      if (qty) text.appendChild(textEl("span", qty + " ", "amount"));
      text.appendChild(document.createTextNode(ing.name));
      if (ing.uncertain) text.appendChild(textEl("span", "approx", "tag"));
      const subs = el("div", "subs");
      const swap = textEl("button", "⇄", "swap");
      swap.title = "Find substitutions";
      swap.addEventListener("click", () => void toggleSubs(ing.name, subs, swap));
      line.append(check, text, swap);
      row.append(line, subs);
    }
    wrap.appendChild(row);
  });

  if (editMode) {
    wrap.appendChild(addRow("+ ingredient", () => {
      readDomIntoRecipe(); // capture current edits first
      recipe?.ingredients.push({ name: "", amount: null, unit: null, uncertain: false });
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
      col.appendChild(textEl("div", convertInText(step.instruction, units, scale)));
      if (step.timestamp !== null) col.appendChild(timestampPill(step.timestamp));
      row.append(num, col);
    }
    wrap.appendChild(row);
  });

  if (editMode) {
    wrap.appendChild(addRow("+ step", () => {
      readDomIntoRecipe(); // capture current edits first
      recipe?.steps.push({ instruction: "", timestamp: null });
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

/** Toggle the inline substitutions panel for an ingredient. */
async function toggleSubs(name: string, container: HTMLElement, swap: HTMLElement): Promise<void> {
  if (container.childElementCount > 0) {
    container.replaceChildren();
    swap.classList.remove("on");
    return;
  }
  swap.classList.add("on");
  container.replaceChildren(textEl("div", "Finding substitutions…", "sub-loading"));

  try {
    const res = await fetch(SUBSTITUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dish: recipe?.title ?? "", ingredient: name }),
    });
    const data = (await res.json()) as SubstituteResponse;
    if (!data.ok) {
      container.replaceChildren(textEl("div", data.message, "sub-loading"));
      return;
    }
    if (data.substitutions.length === 0) {
      container.replaceChildren(textEl("div", "No substitutions found.", "sub-loading"));
      return;
    }
    container.replaceChildren();
    for (const s of data.substitutions) {
      const item = el("div", "sub-item");
      item.appendChild(textEl("span", s.substitute, "sub-name"));
      if (s.note) item.appendChild(textEl("span", ` — ${s.note}`, "sub-note"));
      container.appendChild(item);
    }
  } catch {
    container.replaceChildren(textEl("div", "Couldn't load substitutions.", "sub-loading"));
  }
}

/** The recipe as currently shown: edits captured, scaling + units applied. */
function effectiveRecipe(): Recipe {
  if (editMode) readDomIntoRecipe();
  const base = recipe!;
  return {
    ...base,
    servings: scaleServings(base.servings, scale),
    ingredients: base.ingredients.map((ing) => {
      const m = convertMeasure(ing.amount, ing.unit, units, scale);
      return { ...ing, amount: m.amount, unit: m.unit };
    }),
    steps: base.steps.map((s) => ({
      ...s,
      instruction: convertInText(s.instruction, units, scale),
    })),
  };
}

// --- read edited DOM back into `recipe` ------------------------------------

// Only the active tab's fields are in the DOM at once, so we merge in just what
// is present and leave the rest of `recipe` intact. Header fields (title,
// servings, time) are always present in edit mode.
function readDomIntoRecipe(): void {
  if (!recipe) return;
  const updated: Recipe = { ...recipe };

  const titleEl = app.querySelector(".r-title");
  if (titleEl) updated.title = readText(titleEl) || recipe.title;
  const servEl = app.querySelector(".r-servings");
  if (servEl) updated.servings = readText(servEl) || null;
  const timeEl = app.querySelector(".r-totaltime");
  if (timeEl) updated.totalTime = readText(timeEl) || null;

  if (activeTab === "ingredients") {
    updated.ingredients = Array.from(app.querySelectorAll<HTMLElement>(".ing-edit"))
      .map((edit) => ({
        amount: readText(edit.querySelector(".ing-amount")) || null,
        unit: readText(edit.querySelector(".ing-unit")) || null,
        name: readText(edit.querySelector(".ing-name")),
        uncertain: !!edit.parentElement?.querySelector(".uncertain.on"),
      }))
      .filter((i) => i.name !== "");
  }

  if (activeTab === "steps") {
    updated.steps = Array.from(app.querySelectorAll<HTMLElement>(".row"))
      .filter((row) => row.querySelector(".step-text"))
      .map((row) => ({
        instruction: readText(row.querySelector(".step-text")),
        timestamp: row.dataset.ts !== undefined ? Number(row.dataset.ts) : null,
      }))
      .filter((s) => s.instruction !== "");
  }

  if (activeTab === "overview") {
    const sumEl = app.querySelector(".r-summary");
    if (sumEl) updated.summary = readText(sumEl) || null;
    const notesEl = app.querySelector(".r-notes");
    if (notesEl) updated.notes = readText(notesEl) || null;
  }

  recipe = updated;
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
