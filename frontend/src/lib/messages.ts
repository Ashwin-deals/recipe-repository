import type { AddResult } from "../types";

export function addedMessage({ added, merged }: AddResult): string {
  const mergedText = merged ? `, ${merged} merged with items already there` : "";
  return `Added ${added} new item${added === 1 ? "" : "s"}${mergedText}.`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the toast says after a recipe is deleted along with its list items. */
export function deletedMessage(title: string, removed: number, reduced: number): string {
  if (!removed && !reduced) return `Deleted “${title}”.`;
  const parts = [removed ? `Recipe and ${plural(removed, "list item", "list items")} removed` : "Recipe removed"];
  if (reduced) parts.push(`${plural(reduced, "shared item", "shared items")} reduced`);
  return `${parts.join("; ")}.`;
}
