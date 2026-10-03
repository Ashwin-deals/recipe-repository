import { createContext, useContext, useEffect, useRef } from "react";
import type { Recipe } from "../types";
import type { LoadStatus } from "./useApi";

/** Broadcast after a recipe is saved or deleted anywhere, so pages showing recipes can refresh. */
export type RecipeChange = { kind: "saved"; recipe: Recipe; replaced: boolean } | { kind: "deleted"; id: number };

export interface RecipeLibraryApi {
  /** Every recipe, for search and the chat's context picker. Null until first loaded. */
  recipes: Recipe[] | null;
  status: LoadStatus | "idle";
  /** Load all recipes if they aren't loaded yet. Cheap to call often. */
  load: () => void;
  /** Hand over a full recipe list another view already fetched, to skip a request. */
  prime: (recipes: Recipe[]) => void;
  /** Open the recipe drawer from any page. */
  openRecipe: (recipe: Recipe) => void;
  notify: (change: RecipeChange) => void;
  subscribe: (listener: (change: RecipeChange) => void) => () => void;
}

export const RecipeLibraryContext = createContext<RecipeLibraryApi | null>(null);

export function useRecipeLibrary(): RecipeLibraryApi {
  const value = useContext(RecipeLibraryContext);
  if (!value) throw new Error("useRecipeLibrary must be used inside <RecipeLibraryProvider>");
  return value;
}

/** Call `listener` whenever a recipe is saved or deleted. */
export function useRecipeChanges(listener: (change: RecipeChange) => void): void {
  const { subscribe } = useRecipeLibrary();
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => subscribe((change) => latest.current(change)), [subscribe]);
}
