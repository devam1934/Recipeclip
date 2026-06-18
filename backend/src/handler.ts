// Worker entry. Pipeline: validate request -> extract via the LLM -> respond.
// (KV caching by video id is layered in by a later phase.)

import { createExtractor } from "./llm";
import { LlmError } from "./llm/provider";
import { cacheRecipe, getCachedRecipe } from "./cache";
import { parseExtractRequest } from "./extract";
import { createRecipePage } from "./instacart";
import type {
  Env,
  ExtractErrorCode,
  ExtractResponse,
  Recipe,
  ShopRequest,
  ShopResponse,
  SubstituteRequest,
  SubstituteResponse,
} from "./types";

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

    const path = new URL(request.url).pathname;
    if (path === "/shop") return handleShop(body, env);
    if (path === "/substitute") return handleSubstitute(body, env);

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

      // A usable recipe needs both ingredients and steps. A near-empty result
      // means the transcript was blocked AND the description has no recipe
      // (e.g. it just links to an external site). Say so honestly rather than
      // showing a broken one-line card.
      const usable =
        recipe.isRecipe &&
        recipe.ingredients.length > 0 &&
        recipe.steps.length > 0;

      if (recipe.isRecipe && !usable) {
        const message =
          req.segments.length === 0
            ? "Couldn't read a full recipe here — the transcript wasn't available and the description doesn't contain the recipe (it likely links to an external site)."
            : "Couldn't extract a complete recipe from this video.";
        return fail("not_a_recipe", message, 200);
      }

      // Cache only solid results extracted WITH a transcript, so a later attempt
      // can still improve a description-only result.
      if (usable && req.segments.length > 0) {
        await cacheRecipe(env, req.videoId, recipe);
      }
      return respondWith(recipe, false);
    } catch (err) {
      if (err instanceof LlmError) {
        return fail("llm_error", err.message, 502);
      }
      return fail("internal_error", "Something went wrong.", 500);
    }
  },
};

async function handleShop(body: unknown, env: Env): Promise<Response> {
  const req = body as ShopRequest;
  if (!req || typeof req.title !== "string" || !Array.isArray(req.items)) {
    return json({ ok: false, message: "Bad shop request." } satisfies ShopResponse, 400);
  }
  try {
    const url = await createRecipePage(env, req.title, req.items);
    return json({ ok: true, url } satisfies ShopResponse, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build cart.";
    return json({ ok: false, message } satisfies ShopResponse, 502);
  }
}

async function handleSubstitute(body: unknown, env: Env): Promise<Response> {
  const req = body as SubstituteRequest;
  if (!req || typeof req.dish !== "string" || typeof req.ingredient !== "string") {
    return json({ ok: false, message: "Bad substitute request." } satisfies SubstituteResponse, 400);
  }
  try {
    const substitutions = await createExtractor(env).substitute(req.dish, req.ingredient);
    return json({ ok: true, substitutions } satisfies SubstituteResponse, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not get substitutions.";
    return json({ ok: false, message } satisfies SubstituteResponse, 502);
  }
}

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
