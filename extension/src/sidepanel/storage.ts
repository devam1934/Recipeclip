// Persistence for saved recipes, keyed by YouTube video id, in
// chrome.storage.local. Small wrapper so the panel doesn't sprinkle storage
// keys and shapes around.

import type { Recipe } from "../shared/types";

const KEY_PREFIX = "recipe:";

interface SavedRecipe {
  recipe: Recipe;
  savedAt: number;
}

export async function saveRecipe(videoId: string, recipe: Recipe): Promise<void> {
  const entry: SavedRecipe = { recipe, savedAt: Date.now() };
  await chrome.storage.local.set({ [KEY_PREFIX + videoId]: entry });
}

export async function loadRecipe(videoId: string): Promise<Recipe | null> {
  const key = KEY_PREFIX + videoId;
  const result = await chrome.storage.local.get(key);
  const entry = result[key] as SavedRecipe | undefined;
  return entry?.recipe ?? null;
}
