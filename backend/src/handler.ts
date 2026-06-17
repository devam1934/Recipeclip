// Worker entry. Pipeline: validate request -> extract via the LLM -> respond.
// (KV caching by video id is layered in by a later phase.)

import { createExtractor } from "./llm";
import { LlmError } from "./llm/provider";
import { cacheRecipe, getCachedRecipe } from "./cache";
import { parseExtractRequest } from "./extract";
import type { Env, ExtractErrorCode, ExtractResponse, Recipe } from "./types";

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
    // A missing transcript is OK as long as there's a description to read the
    // recipe from. Only reject when we have neither.
    if (req.segments.length === 0 && req.description.trim() === "") {
      return fail("no_transcript", "No transcript or description to read.", 422);
    }

    try {
      // Cache hit: skip the LLM entirely.
      const cached = await getCachedRecipe(env, req.videoId);
      if (cached) return respondWith(cached, true);

      const extractor = createExtractor(env);
      const recipe = await extractor.extract(req);

      // Cache the result (recipe or non-recipe) so we only call the LLM once
      // per video.
      await cacheRecipe(env, req.videoId, recipe);
      return respondWith(recipe, false);
    } catch (err) {
      if (err instanceof LlmError) {
        return fail("llm_error", err.message, 502);
      }
      return fail("internal_error", "Something went wrong.", 500);
    }
  },
};

/** Turn a recipe (fresh or cached) into the right success/non-recipe response. */
function respondWith(recipe: Recipe, cached: boolean): Response {
  if (!recipe.isRecipe) {
    return fail(
      "not_a_recipe",
      recipe.notes ?? "This video does not appear to be a recipe.",
      200,
    );
  }
  const payload: ExtractResponse = { ok: true, recipe, cached };
  return json(payload, 200);
}

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
