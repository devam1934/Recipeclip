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

export interface SavedEntry {
  videoId: string;
  recipe: Recipe;
  savedAt: number;
}

/** All saved recipes, newest first. */
export async function listSavedRecipes(): Promise<SavedEntry[]> {
  const all = await chrome.storage.local.get(null);
  const out: SavedEntry[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const entry = value as SavedRecipe;
    if (entry?.recipe) {
      out.push({
        videoId: key.slice(KEY_PREFIX.length),
        recipe: entry.recipe,
        savedAt: entry.savedAt ?? 0,
      });
    }
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}

export async function deleteRecipe(videoId: string): Promise<void> {
  await chrome.storage.local.remove([KEY_PREFIX + videoId, CHECKS_PREFIX + videoId]);
}

// --- checklist state (which ingredients/steps are ticked off) --------------

const CHECKS_PREFIX = "checks:";

export interface Checks {
  ingredients: number[];
  steps: number[];
}

export async function saveChecks(videoId: string, checks: Checks): Promise<void> {
  await chrome.storage.local.set({ [CHECKS_PREFIX + videoId]: checks });
}

export async function loadChecks(videoId: string): Promise<Checks> {
  const key = CHECKS_PREFIX + videoId;
  const result = await chrome.storage.local.get(key);
  return (result[key] as Checks | undefined) ?? { ingredients: [], steps: [] };
}
