// The seam that keeps the LLM swappable. The rest of the backend depends only
// on this interface, never on a specific vendor SDK. To switch providers, write
// a new class that implements RecipeExtractor and change one line in handler.ts.

import type { ExtractRequest, Recipe } from "../types";

export interface RecipeExtractor {
  /**
   * Turn gathered video data into a structured Recipe.
   * Implementations must return a Recipe with `isRecipe: false` (rather than
   * inventing content) when the input is not a cooking video.
   * Throws LlmError on provider/transport failures.
   */
  extract(input: ExtractRequest): Promise<Recipe>;
}

/** Raised for any failure talking to the LLM provider. */
export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}
