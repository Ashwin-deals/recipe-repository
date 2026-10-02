import { createContext, useContext } from "react";
import type { ViewGroup, ViewItem } from "../lib/listView";
import type { AddResult, Counts } from "../types";
import type { LoadStatus } from "./useApi";

export interface ShoppingListApi {
  groups: ViewGroup[];
  counts: Counts;
  status: LoadStatus;
  error: string | null;
  pendingCount: number;
  reload: () => Promise<void>;
  toggle: (item: ViewItem) => void;
  clear: (scope: "all" | "checked") => Promise<number>;
  addItem: (line: string) => Promise<AddResult>;
}

export const ShoppingListContext = createContext<ShoppingListApi | null>(null);

export function useShoppingList(): ShoppingListApi {
  const value = useContext(ShoppingListContext);
  if (!value) throw new Error("useShoppingList must be used inside <ShoppingListProvider>");
  return value;
}
