// Worker entry. Pipeline: validate request -> extract via the LLM -> respond.
// (KV caching by video id is layered in by a later phase.)

import { AnthropicExtractor } from "./llm/anthropic";
import { LlmError } from "./llm/provider";
import { parseExtractRequest } from "./extract";
import type { Env, ExtractErrorCode, ExtractResponse } from "./types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method === "GET") {
      return json({ ok: true, status: "RecipeClip backend OK" }, 200);
    }
    if (request.method !== "POST") {
      return fail("bad_request", "Use POST.", 405);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("bad_request", "Body must be valid JSON.", 400);
    }

    const req = parseExtractRequest(body);
    if (!req) {
      return fail("bad_request", "Missing or malformed fields.", 400);
    }
    if (req.segments.length === 0) {
      return fail("no_transcript", "No transcript was provided.", 422);
    }

    try {
      const extractor = new AnthropicExtractor(env.ANTHROPIC_API_KEY);
      const recipe = await extractor.extract(req);

      if (!recipe.isRecipe) {
        return fail(
          "not_a_recipe",
          recipe.notes ?? "This video does not appear to be a recipe.",
          200,
        );
      }

      const payload: ExtractResponse = { ok: true, recipe, cached: false };
      return json(payload, 200);
    } catch (err) {
      if (err instanceof LlmError) {
        return fail("llm_error", err.message, 502);
      }
      return fail("internal_error", "Something went wrong.", 500);
    }
  },
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function fail(
  error: ExtractErrorCode,
  message: string,
  status: number,
): Response {
  const payload: ExtractResponse = { ok: false, error, message };
  return json(payload, status);
}
