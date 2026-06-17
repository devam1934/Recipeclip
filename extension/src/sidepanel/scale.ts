// Ingredient/serving scaling for the servings scaler. Amounts are free-text
// strings ("200 g", "1 1/2 cups", "2"), so we parse the leading quantity,
// multiply, and reformat — falling back to the original string when there's no
// number to scale (e.g. "to taste").

interface LeadingQuantity {
  value: number;
  rest: string; // everything after the number, e.g. " cups"
}

/** Pull a leading number (int, decimal, fraction, or mixed) off a string. */
export function parseLeadingQuantity(text: string): LeadingQuantity | null {
  const s = text.trimStart();

  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)/); // "1 1/2"
  if (mixed) {
    const [whole, num, den] = [mixed[1], mixed[2], mixed[3]].map(Number);
    return { value: whole + num / den, rest: s.slice(mixed[0].length) };
  }

  const frac = s.match(/^(\d+)\/(\d+)/); // "1/2"
  if (frac) {
    return { value: Number(frac[1]) / Number(frac[2]), rest: s.slice(frac[0].length) };
  }

  const dec = s.match(/^\d+(?:\.\d+)?/); // "200" or "1.5"
  if (dec) {
    return { value: Number(dec[0]), rest: s.slice(dec[0].length) };
  }

  return null;
}

/** Render a number back to a cook-friendly string (whole, fraction, or mixed). */
export function formatQuantity(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  const whole = Math.floor(rounded);
  const frac = rounded - whole;

  if (frac < 0.02) return String(whole);

  // Snap the fractional part to a common cooking fraction if it's close.
  for (const den of [2, 3, 4, 8]) {
    const num = Math.round(frac * den);
    if (num > 0 && num < den && Math.abs(frac - num / den) < 0.03) {
      const fraction = `${num}/${den}`;
      return whole > 0 ? `${whole} ${fraction}` : fraction;
    }
  }

  return String(Math.round(rounded * 100) / 100); // fall back to a decimal
}

/** Scale a free-text amount by a factor. Returns the original if unparseable. */
export function scaleAmount(amount: string | null, factor: number): string | null {
  if (!amount || factor === 1) return amount;
  const parsed = parseLeadingQuantity(amount);
  if (!parsed) return amount;
  return formatQuantity(parsed.value * factor) + parsed.rest;
}

/** Scale a servings string ("6", "4-6 people") by a factor. */
export function scaleServings(servings: string | null, factor: number): string | null {
  if (!servings || factor === 1) return servings;
  // Scale every number found, so ranges like "4-6" both move.
  return servings.replace(/\d+(?:\.\d+)?/g, (n) =>
    formatQuantity(Number(n) * factor),
  );
}
