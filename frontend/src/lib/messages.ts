import type { AddResult } from "../types";

export function addedMessage({ added, merged }: AddResult): string {
  const mergedText = merged ? `, ${merged} merged with items already there` : "";
  return `Added ${added} new item${added === 1 ? "" : "s"}${mergedText}.`;
}
