// Picks the LLM provider from config. This is the single place that knows about
// concrete providers; the rest of the backend depends only on RecipeExtractor.
//
// Set LLM_PROVIDER in wrangler.toml ("gemini" by default, or "anthropic").
// Swapping providers — or adding a new one — is a change to this file alone.

import type { Env } from "../types";
import { AnthropicExtractor } from "./anthropic";
import { GeminiExtractor } from "./gemini";
import { LlmError, type RecipeExtractor } from "./provider";

export function createExtractor(env: Env): RecipeExtractor {
  const provider = (env.LLM_PROVIDER ?? "gemini").toLowerCase();

  switch (provider) {
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) {
        throw new LlmError("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
      }
      return new AnthropicExtractor(env.ANTHROPIC_API_KEY);

    case "gemini":
      if (!env.GEMINI_API_KEY) {
        throw new LlmError("LLM_PROVIDER=gemini but GEMINI_API_KEY is not set.");
      }
      return new GeminiExtractor(env.GEMINI_API_KEY);

    default:
      throw new LlmError(`Unknown LLM_PROVIDER: ${provider}`);
  }
}
