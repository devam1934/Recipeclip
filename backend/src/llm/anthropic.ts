// Anthropic Claude implementation of RecipeExtractor.
//
// We use tool use as the structured-output mechanism: Claude is forced to call
// a single `save_recipe` tool whose input_schema is our Recipe shape, so the
// response is guaranteed to be a JSON object rather than prose we'd have to
// parse out of free text. The raw tool input is still run through
// normalizeRecipe() before leaving the backend.

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractRequest, Recipe } from "../types";
import { buildUserPrompt, normalizeRecipe, SYSTEM_PROMPT } from "../extract";
import { LlmError, type RecipeExtractor } from "./provider";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const TOOL_NAME = "save_recipe";

const RECIPE_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Save the structured recipe extracted from the video.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      servings: { type: ["string", "null"] },
      totalTime: { type: ["string", "null"] },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            amount: { type: ["string", "null"] },
            unit: { type: ["string", "null"] },
            uncertain: {
              type: "boolean",
              description: "true when the amount was inferred, not stated.",
            },
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
            timestamp: {
              type: ["number", "null"],
              description: "Seconds into the video where this step begins.",
            },
          },
          required: ["instruction"],
        },
      },
      notes: { type: ["string", "null"] },
      sourceConfidence: { type: "string", enum: ["high", "medium", "low"] },
      isRecipe: {
        type: "boolean",
        description: "false if the video is not a cooking recipe.",
      },
    },
    required: ["title", "ingredients", "steps", "sourceConfidence", "isRecipe"],
  },
};

export class AnthropicExtractor implements RecipeExtractor {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extract(input: ExtractRequest): Promise<Recipe> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [RECIPE_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      });
    } catch (err) {
      throw new LlmError(
        err instanceof Error ? err.message : "Unknown LLM error",
      );
    }

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!toolUse) {
      throw new LlmError("Model did not return a recipe via the expected tool.");
    }

    return normalizeRecipe(toolUse.input);
  }
}
