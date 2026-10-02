import type { Counts, ListData, ListGroup, ListItem } from "../types";
import type { Queue } from "./offlineQueue";

export interface ViewItem extends ListItem {
  pending: boolean;
}

export interface ViewGroup extends Omit<ListGroup, "items"> {
  items: ViewItem[];
}

/** Overlay queued (not yet synced) check changes onto the server's list. */
export function applyPending(data: ListData, pending: Queue): { groups: ViewGroup[]; counts: Counts } {
  let total = 0;
  let checked = 0;
  const groups = data.groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const queued = pending[String(item.id)];
      const isChecked = queued ?? item.checked;
      total += 1;
      if (isChecked) checked += 1;
      return { ...item, checked: isChecked, pending: queued !== undefined };
    }),
  }));
  return { groups, counts: { total, checked, open: total - checked } };
}

/** Return a copy of the list with one item's checked flag changed. */
export function setChecked(data: ListData, id: number, checked: boolean): ListData {
  return {
    ...data,
    groups: data.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => (item.id === id ? { ...item, checked } : item)),
    })),
  };
}
