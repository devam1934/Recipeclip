// Unit conversion for the metric ↔ US toggle. Ingredient amount and unit are
// separate fields (amount "1 1/2", unit "cups"), so we parse the numeric amount,
// apply the servings scale, and — unless the system is "orig" — convert the
// measurement into the target system, picking a sensible unit for the magnitude.
//
// Unknown units (e.g. "clove", "pinch", or no unit at all) are left untouched
// and only get scaled.

import { formatQuantity, parseLeadingQuantity } from "./scale";

export type UnitSystem = "orig" | "us" | "metric";

type MeasureType = "volume" | "weight";

interface UnitInfo {
  type: MeasureType;
  toBase: number; // factor to ml (volume) or g (weight)
}

// Many spellings -> canonical measure. "oz" is weight; fluid ounces are "fl oz".
const UNITS: Record<string, UnitInfo> = {
  // volume (base: ml)
  tsp: { type: "volume", toBase: 4.92892 },
  teaspoon: { type: "volume", toBase: 4.92892 },
  teaspoons: { type: "volume", toBase: 4.92892 },
  tbsp: { type: "volume", toBase: 14.7868 },
  tbs: { type: "volume", toBase: 14.7868 },
  tablespoon: { type: "volume", toBase: 14.7868 },
  tablespoons: { type: "volume", toBase: 14.7868 },
  cup: { type: "volume", toBase: 236.588 },
  cups: { type: "volume", toBase: 236.588 },
  "fl oz": { type: "volume", toBase: 29.5735 },
  floz: { type: "volume", toBase: 29.5735 },
  pint: { type: "volume", toBase: 473.176 },
  pints: { type: "volume", toBase: 473.176 },
  quart: { type: "volume", toBase: 946.353 },
  quarts: { type: "volume", toBase: 946.353 },
  gallon: { type: "volume", toBase: 3785.41 },
  ml: { type: "volume", toBase: 1 },
  milliliter: { type: "volume", toBase: 1 },
  millilitre: { type: "volume", toBase: 1 },
  l: { type: "volume", toBase: 1000 },
  liter: { type: "volume", toBase: 1000 },
  litre: { type: "volume", toBase: 1000 },
  // weight (base: g)
  g: { type: "weight", toBase: 1 },
  gram: { type: "weight", toBase: 1 },
  grams: { type: "weight", toBase: 1 },
  kg: { type: "weight", toBase: 1000 },
  kilogram: { type: "weight", toBase: 1000 },
  oz: { type: "weight", toBase: 28.3495 },
  ounce: { type: "weight", toBase: 28.3495 },
  ounces: { type: "weight", toBase: 28.3495 },
  lb: { type: "weight", toBase: 453.592 },
  lbs: { type: "weight", toBase: 453.592 },
  pound: { type: "weight", toBase: 453.592 },
  pounds: { type: "weight", toBase: 453.592 },
};

export interface Measure {
  amount: string | null;
  unit: string | null;
}

/** Scale and (optionally) convert an ingredient measure to a target system. */
export function convertMeasure(
  amount: string | null,
  unit: string | null,
  system: UnitSystem,
  scale: number,
): Measure {
  const parsed = amount ? parseLeadingQuantity(amount) : null;
  if (!parsed) return { amount, unit }; // nothing numeric to work with

  const value = parsed.value * scale;

  const info = unit ? UNITS[unit.trim().toLowerCase()] : undefined;
  if (system === "orig" || !info) {
    return { amount: formatQuantity(value) + parsed.rest, unit };
  }

  const base = value * info.toBase;
  return info.type === "volume"
    ? pickVolume(base, system)
    : pickWeight(base, system);
}

function pickVolume(ml: number, system: UnitSystem): Measure {
  if (system === "metric") {
    return ml >= 1000
      ? { amount: formatMetric(ml / 1000), unit: "l" }
      : { amount: formatMetric(ml), unit: "ml" };
  }
  // US
  if (ml >= 236.588 * 0.75) return usVolume(ml / 236.588, "cup");
  if (ml >= 14.7868) return usVolume(ml / 14.7868, "tbsp");
  return usVolume(ml / 4.92892, "tsp");
}

function usVolume(value: number, unit: "cup" | "tbsp" | "tsp"): Measure {
  const label = unit === "cup" && Math.abs(value - 1) > 0.01 ? "cups" : unit;
  return { amount: formatQuantity(value), unit: label };
}

function pickWeight(g: number, system: UnitSystem): Measure {
  if (system === "metric") {
    return g >= 1000
      ? { amount: formatMetric(g / 1000), unit: "kg" }
      : { amount: formatMetric(g), unit: "g" };
  }
  // US
  const oz = g / 28.3495;
  if (oz >= 16) return { amount: formatQuantity(oz / 16), unit: "lb" };
  return { amount: formatQuantity(oz), unit: "oz" };
}

/** Metric numbers read better as plain decimals than fractions. */
function formatMetric(value: number): string {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}
