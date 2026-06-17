// Recipe -> Markdown. Pure and dependency-free so it's trivial to test and
// reuse (clipboard copy and file download both go through here).

import type { Recipe } from "../shared/types";

export function toMarkdown(recipe: Recipe): string {
  const lines: string[] = [];

  lines.push(`# ${recipe.title || "Untitled recipe"}`);

  const meta = [
    recipe.servings ? `Serves ${recipe.servings}` : null,
    recipe.totalTime,
  ].filter(Boolean);
  if (meta.length) lines.push("", `_${meta.join(" · ")}_`);

  if (recipe.ingredients.length) {
    lines.push("", "## Ingredients", "");
    for (const ing of recipe.ingredients) {
      const qty = [ing.amount, ing.unit].filter(Boolean).join(" ");
      const flag = ing.uncertain ? " _(approx)_" : "";
      lines.push(`- ${[qty, ing.name].filter(Boolean).join(" ")}${flag}`);
    }
  }

  if (recipe.steps.length) {
    lines.push("", "## Steps", "");
    recipe.steps.forEach((step, i) => {
      const ts = step.timestamp !== null ? ` _(${formatTimestamp(step.timestamp)})_` : "";
      lines.push(`${i + 1}. ${step.instruction}${ts}`);
    });
  }

  if (recipe.notes) lines.push("", "## Notes", "", recipe.notes);

  return lines.join("\n") + "\n";
}

export function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
