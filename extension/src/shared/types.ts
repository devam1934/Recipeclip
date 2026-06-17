// Canonical data shapes shared across the extension and (mirrored in) the
// backend. Keep this in sync with backend/src/types.ts. We deliberately do NOT
// use a monorepo workspace just to share one file — duplication here is cheaper
// than the build config a shared package would add.

/** How confident the model is that the extracted recipe is accurate. */
export type SourceConfidence = "high" | "medium" | "low";

/** Rough effort level for the recipe. */
export type Difficulty = "easy" | "medium" | "hard";

export interface Ingredient {
  name: string;
  /** Quantity as a string ("1 1/2", "2"), or null when unknown. */
  amount: string | null;
  /** Unit ("cup", "g", "tbsp"), or null when not applicable/unknown. */
  unit: string | null;
  /** True when the model inferred the amount rather than reading it directly. */
  uncertain: boolean;
}

export interface Step {
  instruction: string;
  /** Seconds into the video this step starts, or null if unknown. */
  timestamp: number | null;
}

export interface Recipe {
  title: string;
  servings: string | null;
  totalTime: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  notes: string | null;
  sourceConfidence: SourceConfidence;
  /** False when the video does not appear to be a recipe. */
  isRecipe: boolean;

  // --- "free" extras filled in by the same extraction call ---
  /** One- or two-sentence TL;DR of the dish. */
  summary: string | null;
  /** Dietary tags, e.g. ["vegan", "gluten-free"]. */
  dietaryTags: string[];
  difficulty: Difficulty | null;
  /** Cuisine, e.g. "Italian". */
  cuisine: string | null;
  /** Tools/equipment needed, e.g. ["whisk", "9x13 pan"]. */
  equipment: string[];
}

/** One timestamped line of transcript. */
export interface TranscriptSegment {
  /** Seconds into the video. */
  start: number;
  text: string;
}

/** Payload the extension sends to the backend. */
export interface ExtractRequest {
  videoId: string;
  title: string;
  description: string;
  segments: TranscriptSegment[];
}

/** Backend response. Either a recipe, or a clean failure signal. */
export type ExtractResponse =
  | { ok: true; recipe: Recipe; cached: boolean }
  | { ok: false; error: ExtractErrorCode; message: string };

export type ExtractErrorCode =
  | "not_a_recipe"
  | "no_transcript"
  | "bad_request"
  | "llm_error"
  | "internal_error";
