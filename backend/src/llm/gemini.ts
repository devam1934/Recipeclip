// Google Gemini implementation of RecipeExtractor.
//
// Gemini supports structured output natively: we pass a `responseSchema` and
// ask for `application/json`, so the model returns a JSON object matching our
// Recipe shape rather than prose. We call the REST API directly with `fetch`
// (no SDK) — it's a single endpoint and keeps the Worker dependency-free.
//
// Note: Gemini's schema dialect differs slightly from JSON Schema — nullable
// fields use `nullable: true` rather than a `["string", "null"]` type union.

import type { ExtractRequest, Recipe } from "../types";
import { buildUserPrompt, normalizeRecipe, SYSTEM_PROMPT } from "../extract";
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
  },
  required: ["title", "ingredients", "steps", "sourceConfidence", "isRecipe"],
};

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
  }[];
}

export class GeminiExtractor implements RecipeExtractor {
  constructor(private apiKey: string) {}

  async extract(input: ExtractRequest): Promise<Recipe> {
    const body = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RECIPE_SCHEMA,
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LlmError("Gemini returned invalid JSON.");
    }

    return normalizeRecipe(parsed);
  }
}
