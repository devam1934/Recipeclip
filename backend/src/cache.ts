// Recipe cache, keyed by YouTube video id, backed by Workers KV. One LLM call
// per video: a cache hit skips the model entirely.
//
// Cache reads/writes are best-effort — if KV misbehaves we fall back to a live
// extraction rather than failing the request, so a cache outage degrades to
// "slower", never "broken".

import type { Env, Recipe } from "./types";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MIN_TTL_SECONDS = 60; // KV's floor

export async function getCachedRecipe(
  env: Env,
  videoId: string,
): Promise<Recipe | null> {
  try {
    return await env.RECIPE_CACHE.get<Recipe>(videoId, "json");
  } catch {
    return null;
  }
}

export async function cacheRecipe(
  env: Env,
  videoId: string,
  recipe: Recipe,
): Promise<void> {
  try {
    await env.RECIPE_CACHE.put(videoId, JSON.stringify(recipe), {
      expirationTtl: ttlSeconds(env),
    });
  } catch {
    // Non-fatal: the caller already has the recipe to return.
  }
}

function ttlSeconds(env: Env): number {
  const parsed = Number(env.CACHE_TTL_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
  return Math.max(MIN_TTL_SECONDS, Math.round(parsed));
}
