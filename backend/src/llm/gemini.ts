// Google Gemini implementation of RecipeExtractor.
//
// Gemini supports structured output natively: we pass a `responseSchema` and
// ask for `application/json`, so the model returns a JSON object matching our
// Recipe shape rather than prose. We call the REST API directly with `fetch`
// (no SDK) — it's a single endpoint and keeps the Worker dependency-free.
//
// Note: Gemini's schema dialect differs slightly from JSON Schema — nullable
// fields use `nullable: true` rather than a `["string", "null"]` type union.

import type { ExtractRequest, Recipe, Substitution } from "../types";
import {
  buildSubstitutePrompt,
  buildUserPrompt,
  normalizeRecipe,
  normalizeSubstitutions,
  SUBSTITUTE_SYSTEM,
  SYSTEM_PROMPT,
} from "../extract";
import { LlmError, type RecipeExtractor } from "./provider";

const MODEL = "gemini-2.5-flash";
const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// Gemini-flavored schema (nullable via `nullable: true`, enums via `enum`).
const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    servings: { type: "string", nullable: true },
    totalTime: { type: "string", nullable: true },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "string", nullable: true },
          unit: { type: "string", nullable: true },
          uncertain: { type: "boolean" },
        },
        required: ["name", "uncertain"],
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: { type: "string" },
          timestamp: { type: "number", nullable: true },
        },
        required: ["instruction"],
      },
    },
    notes: { type: "string", nullable: true },
    sourceConfidence: { type: "string", enum: ["high", "medium", "low"] },
    isRecipe: { type: "boolean" },
    summary: { type: "string", nullable: true },
    dietaryTags: { type: "array", items: { type: "string" } },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"], nullable: true },
    cuisine: { type: "string", nullable: true },
    equipment: { type: "array", items: { type: "string" } },
    backstory: { type: "string", nullable: true },
    chefTip: { type: "string", nullable: true },
    nutrition: {
      type: "object",
      nullable: true,
      properties: {
        calories: { type: "number", nullable: true },
        protein: { type: "number", nullable: true },
        carbs: { type: "number", nullable: true },
        fat: { type: "number", nullable: true },
      },
    },
  },
  required: ["title", "ingredients", "steps", "sourceConfidence", "isRecipe"],
};

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
  }[];
}

const SUBSTITUTION_SCHEMA = {
  type: "object",
  properties: {
    substitutions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          substitute: { type: "string" },
          note: { type: "string", nullable: true },
        },
        required: ["substitute"],
      },
    },
  },
  required: ["substitutions"],
};

export class GeminiExtractor implements RecipeExtractor {
  constructor(private apiKey: string) {}

  async extract(input: ExtractRequest): Promise<Recipe> {
    const parsed = await this.generate(SYSTEM_PROMPT, buildUserPrompt(input), RECIPE_SCHEMA);
    return normalizeRecipe(parsed);
  }

  async substitute(dish: string, ingredient: string): Promise<Substitution[]> {
    const parsed = await this.generate(
      SUBSTITUTE_SYSTEM,
      buildSubstitutePrompt(dish, ingredient),
      SUBSTITUTION_SCHEMA,
    );
    return normalizeSubstitutions(parsed);
  }

  /** Single structured-output call: returns the parsed JSON object. */
  private async generate(
    system: string,
    user: string,
    responseSchema: unknown,
  ): Promise<unknown> {
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        // Disable "thinking" — these tasks don't need it and it's much faster.
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    let res: Response;
    try {
      res = await fetch(ENDPOINT(MODEL, this.apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmError(err instanceof Error ? err.message : "Network error");
    }

    if (!res.ok) {
      throw new LlmError(`Gemini API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new LlmError("Gemini returned no content.");

    try {
      return JSON.parse(text);
    } catch {
      throw new LlmError("Gemini returned invalid JSON.");
    }
  }
}
