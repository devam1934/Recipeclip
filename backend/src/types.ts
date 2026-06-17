// Mirror of extension/src/shared/types.ts. Kept in sync by hand; see the note
// in that file for why we don't use a shared workspace package.

export type SourceConfidence = "high" | "medium" | "low";

export type Difficulty = "easy" | "medium" | "hard";

export interface Ingredient {
  name: string;
  amount: string | null;
  unit: string | null;
  uncertain: boolean;
}

export interface Step {
  instruction: string;
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
  isRecipe: boolean;

  summary: string | null;
  dietaryTags: string[];
  difficulty: Difficulty | null;
  cuisine: string | null;
  equipment: string[];
}

export interface TranscriptSegment {
  start: number;
  text: string;
}

export interface ExtractRequest {
  videoId: string;
  title: string;
  description: string;
  segments: TranscriptSegment[];
}

export type ExtractErrorCode =
  | "not_a_recipe"
  | "no_transcript"
  | "bad_request"
  | "llm_error"
  | "internal_error";

export type ExtractResponse =
  | { ok: true; recipe: Recipe; cached: boolean }
  | { ok: false; error: ExtractErrorCode; message: string };

/** Bindings configured in wrangler.toml + secrets. */
export interface Env {
  /** "gemini" (default) or "anthropic". */
  LLM_PROVIDER?: string;
  /** Required when LLM_PROVIDER=gemini. */
  GEMINI_API_KEY?: string;
  /** Required when LLM_PROVIDER=anthropic. */
  ANTHROPIC_API_KEY?: string;
  RECIPE_CACHE: KVNamespace;
  CACHE_TTL_SECONDS: string;
}
