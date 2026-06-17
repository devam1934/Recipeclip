// Provider-agnostic extraction logic: input validation, the prompt (including
// the fusion rules), and normalization of whatever the model returns into a
// well-formed Recipe. The vendor-specific call lives in llm/anthropic.ts.

import type {
  Difficulty,
  ExtractRequest,
  Ingredient,
  Recipe,
  Step,
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
  "- If the video is not a cooking recipe (e.g. a vlog, review, or unrelated",
  "  topic), set `isRecipe` to false, leave ingredients and steps empty, and put",
  "  a one-line explanation in `notes`. Do not fabricate a recipe.",
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
  };
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
