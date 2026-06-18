// Provider-agnostic extraction logic: input validation, the prompt (including
// the fusion rules), and normalization of whatever the model returns into a
// well-formed Recipe. The vendor-specific call lives in llm/anthropic.ts.

import type {
  Difficulty,
  ExtractRequest,
  Ingredient,
  Recipe,
  Step,
  Substitution,
  TranscriptSegment,
} from "./types";

/** Cap transcript size so a very long video can't blow the token budget. */
const MAX_TRANSCRIPT_CHARS = 24_000;

/** Validate and coerce an untrusted request body. Returns null if invalid. */
export function parseExtractRequest(body: unknown): ExtractRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.videoId !== "string" || b.videoId.length === 0) return null;
  if (typeof b.title !== "string") return null;
  if (typeof b.description !== "string") return null;
  if (!Array.isArray(b.segments)) return null;

  const segments: TranscriptSegment[] = [];
  for (const seg of b.segments) {
    if (typeof seg !== "object" || seg === null) continue;
    const s = seg as Record<string, unknown>;
    if (typeof s.text !== "string" || s.text.trim() === "") continue;
    segments.push({
      start: typeof s.start === "number" ? Math.max(0, Math.round(s.start)) : 0,
      text: s.text,
    });
  }

  return {
    videoId: b.videoId,
    title: b.title,
    description: b.description,
    segments,
  };
}

export const SYSTEM_PROMPT = [
  "You extract structured cooking recipes from YouTube video data.",
  "",
  "You are given a video title, its description, and a timestamped transcript.",
  "Return the recipe by calling the provided tool. Follow these rules exactly:",
  "",
  "FUSION RULES (how to combine the two sources):",
  "- The DESCRIPTION is the highest-priority source for exact ingredient",
  "  quantities and units. Trust it over the transcript for amounts.",
  "- The TRANSCRIPT is the source of truth for step ORDER and TIMESTAMPS.",
  "- For each step, set `timestamp` to the integer second (from the transcript)",
  "  where that step begins. If you cannot place a step, use null.",
  "- NEVER invent quantities. If an amount is unclear or only implied, include",
  "  the ingredient but set `uncertain` to true and leave `amount`/`unit` null",
  "  (or your best partial guess). Exact, stated amounts get `uncertain: false`.",
  "",
  "NON-RECIPE DETECTION:",
  "- Set `isRecipe` to false ONLY for genuinely non-cooking videos (a vlog,",
  "  review, or unrelated topic). Leave ingredients/steps empty and explain in",
  "  `notes`. Do not fabricate a recipe.",
  "- BUT if it clearly IS a cooking video and the text is just incomplete (e.g.",
  "  the description links out to sub-recipes, or there's no transcript), keep",
  "  `isRecipe` true, extract whatever ingredients and steps you can, set",
  "  `sourceConfidence` to low, and note the limitation. Prefer a partial recipe",
  "  over rejecting it.",
  "",
  "CONFIDENCE:",
  "- Set `sourceConfidence` to high/medium/low reflecting how complete and",
  "  reliable the extracted recipe is.",
  "",
  "EXTRAS (fill these in from the same content — do not guess wildly):",
  "- `summary`: a one- or two-sentence description of the dish.",
  "- `dietaryTags`: lowercase tags that clearly apply, from common ones like",
  "  vegan, vegetarian, gluten-free, dairy-free, nut-free, keto, low-carb. Only",
  "  include a tag when the recipe genuinely qualifies; otherwise leave it out.",
  "- `difficulty`: easy, medium, or hard.",
  "- `cuisine`: e.g. Italian, Mexican, Thai (or null if unclear).",
  "- `equipment`: notable tools needed (e.g. blender, 9x13 pan, whisk).",
  "- `backstory`: 2-3 sentences on the dish's origin, history, or region.",
  "- `chefTip`: one key technique tip that makes or breaks the dish.",
  "- `nutrition`: a ROUGH per-serving estimate with `calories`, `protein`,",
  "  `carbs`, and `fat` (grams). Estimate from the ingredients; use null for any",
  "  value you cannot reasonably estimate.",
].join("\n");

/** Build the user message from the gathered data. */
export function buildUserPrompt(req: ExtractRequest): string {
  const transcript = formatTranscript(req.segments);
  return [
    `TITLE:\n${req.title}`,
    "",
    `DESCRIPTION:\n${req.description || "(none provided)"}`,
    "",
    "TRANSCRIPT (each line is `[seconds] text`):",
    transcript || "(no transcript available)",
  ].join("\n");
}

/** Render segments as `[123] text`, truncated to a safe length. */
function formatTranscript(segments: TranscriptSegment[]): string {
  let out = "";
  for (const seg of segments) {
    const line = `[${seg.start}] ${seg.text}\n`;
    if (out.length + line.length > MAX_TRANSCRIPT_CHARS) {
      out += "[...transcript truncated...]";
      break;
    }
    out += line;
  }
  return out.trim();
}

/**
 * Coerce the model's tool input into a guaranteed-valid Recipe. The model is
 * instructed to follow the schema, but we never trust it blindly.
 */
export function normalizeRecipe(raw: unknown): Recipe {
  const r = (raw ?? {}) as Record<string, unknown>;

  const isRecipe = r.isRecipe !== false; // default true unless explicitly false

  return {
    title: asString(r.title) ?? "Untitled recipe",
    servings: asNullableString(r.servings),
    totalTime: asNullableString(r.totalTime),
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.map(normalizeIngredient)
      : [],
    steps: Array.isArray(r.steps) ? r.steps.map(normalizeStep) : [],
    notes: asNullableString(r.notes),
    sourceConfidence: asConfidence(r.sourceConfidence),
    isRecipe,
    summary: asNullableString(r.summary),
    dietaryTags: asStringArray(r.dietaryTags),
    difficulty: asDifficulty(r.difficulty),
    cuisine: asNullableString(r.cuisine),
    equipment: asStringArray(r.equipment),
    backstory: asNullableString(r.backstory),
    chefTip: asNullableString(r.chefTip),
    nutrition: asNutrition(r.nutrition),
  };
}

function asNutrition(v: unknown): Recipe["nutrition"] {
  if (typeof v !== "object" || v === null) return null;
  const n = v as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? Math.round(x) : null;
  const nutrition = {
    calories: num(n.calories),
    protein: num(n.protein),
    carbs: num(n.carbs),
    fat: num(n.fat),
  };
  // All null -> treat as no estimate.
  return Object.values(nutrition).some((x) => x !== null) ? nutrition : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x !== "");
}

function asDifficulty(v: unknown): Difficulty | null {
  return v === "easy" || v === "medium" || v === "hard" ? v : null;
}

function normalizeIngredient(raw: unknown): Ingredient {
  const i = (raw ?? {}) as Record<string, unknown>;
  return {
    name: asString(i.name) ?? "",
    amount: asNullableString(i.amount),
    unit: asNullableString(i.unit),
    uncertain: i.uncertain === true,
  };
}

function normalizeStep(raw: unknown): Step {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    instruction: asString(s.instruction) ?? "",
    timestamp:
      typeof s.timestamp === "number" ? Math.max(0, Math.round(s.timestamp)) : null,
  };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function asNullableString(v: unknown): string | null {
  return asString(v);
}

function asConfidence(v: unknown): Recipe["sourceConfidence"] {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

// --- substitutions ---------------------------------------------------------

export const SUBSTITUTE_SYSTEM =
  "You are a practical cooking assistant. Suggest realistic ingredient " +
  "substitutions and keep notes short (ratio or effect on taste/texture).";

export function buildSubstitutePrompt(dish: string, ingredient: string): string {
  return [
    `Recipe: ${dish || "(unknown dish)"}`,
    `Ingredient to replace: ${ingredient}`,
    "",
    "Suggest 2-4 common substitutions. For each, give the substitute and a",
    "short note on the ratio to use or its effect.",
  ].join("\n");
}

/** Coerce model output (array or { substitutions: [...] }) into Substitutions. */
export function normalizeSubstitutions(raw: unknown): Substitution[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { substitutions?: unknown })?.substitutions)
      ? (raw as { substitutions: unknown[] }).substitutions
      : [];

  return arr
    .map((item) => {
      const s = (item ?? {}) as Record<string, unknown>;
      return {
        substitute: asString(s.substitute) ?? "",
        note: asNullableString(s.note),
      };
    })
    .filter((s) => s.substitute !== "");
}
