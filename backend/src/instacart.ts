// Instacart Developer Platform client. Turns our ingredient list into a hosted
// "shoppable recipe" page and returns its URL. We only send generic product
// names + quantities; Instacart does the product matching and the user picks
// the actual products and store on the page.
//
// Docs: POST /idp/v1/products/recipe, Bearer auth, returns products_link_url.

import type { Env, ShopLineItem } from "./types";

const DEFAULT_BASE = "https://connect.instacart.com";
const RECIPE_PATH = "/idp/v1/products/recipe";

export class InstacartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstacartError";
  }
}

/** Map our unit strings to Instacart's supported units; null = omit (defaults
 * to "each"). Passing an unsupported unit silently breaks quantity matching, so
 * we only send units we know are valid. */
const UNIT_MAP: Record<string, string> = {
  tsp: "teaspoon",
  teaspoon: "teaspoon",
  teaspoons: "teaspoon",
  tbsp: "tablespoon",
  tablespoon: "tablespoon",
  tablespoons: "tablespoon",
  cup: "cup",
  cups: "cup",
  oz: "ounce",
  ounce: "ounce",
  ounces: "ounce",
  lb: "pound",
  lbs: "pound",
  pound: "pound",
  pounds: "pound",
  g: "gram",
  gram: "gram",
  grams: "gram",
  kg: "kilogram",
  ml: "milliliter",
  l: "liter",
};

/** Strip quantities/brands/prep notes so Instacart matches on the core item. */
function cleanName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "") // drop "(optional)" etc.
    .split(",")[0] // "onion, diced" -> "onion"
    .trim();
}

interface InstacartIngredient {
  name: string;
  measurements?: { quantity: number; unit: string }[];
}

function toIngredient(item: ShopLineItem): InstacartIngredient | null {
  const name = cleanName(item.name);
  if (!name) return null;

  const unit = item.unit ? UNIT_MAP[item.unit.trim().toLowerCase()] : undefined;
  const ingredient: InstacartIngredient = { name };
  if (item.quantity && item.quantity > 0 && unit) {
    ingredient.measurements = [{ quantity: item.quantity, unit }];
  }
  return ingredient;
}

/** Create a shoppable recipe page and return its URL. */
export async function createRecipePage(
  env: Env,
  title: string,
  items: ShopLineItem[],
): Promise<string> {
  if (!env.INSTACART_API_KEY) {
    throw new InstacartError("INSTACART_API_KEY is not set.");
  }

  const ingredients = items
    .map(toIngredient)
    .filter((x): x is InstacartIngredient => x !== null);
  if (ingredients.length === 0) {
    throw new InstacartError("No ingredients to shop.");
  }

  const base = env.INSTACART_API_BASE || DEFAULT_BASE;
  const body = {
    title: title || "Recipe",
    ingredients,
    landing_page_configuration: { enable_pantry_items: true },
  };

  let res: Response;
  try {
    res = await fetch(base + RECIPE_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${env.INSTACART_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new InstacartError(err instanceof Error ? err.message : "Network error");
  }

  if (!res.ok) {
    throw new InstacartError(`Instacart API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { products_link_url?: string };
  if (!data.products_link_url) {
    throw new InstacartError("Instacart did not return a link.");
  }
  return data.products_link_url;
}
