import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { getRecipes } from "../api/endpoints";
import type { LoadStatus } from "../hooks/useApi";
import { useChat } from "../hooks/useChat";
import { RecipeLibraryContext, type RecipeChange, type RecipeLibraryApi } from "../hooks/useRecipeLibrary";
import type { Recipe } from "../types";
import { RecipeDrawer } from "./RecipeDrawer";

function applyChange(recipes: Recipe[] | null, change: RecipeChange): Recipe[] | null {
  if (!recipes) return recipes;
  if (change.kind === "deleted") return recipes.filter((r) => r.id !== change.id);
  if (change.replaced) return recipes.map((r) => (r.id === change.recipe.id ? change.recipe : r));
  return [change.recipe, ...recipes.filter((r) => r.id !== change.recipe.id)];
}

/**
 * Knows every recipe (loaded on first use, for search and the chat), owns the recipe drawer so
 * it can open from any page, and tells subscribers when a recipe is saved or deleted.
 */
export function RecipeLibraryProvider({ children }: { children: ReactNode }) {
  const { openChat } = useChat();
  const { pathname } = useLocation();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [status, setStatus] = useState<RecipeLibraryApi["status"]>("idle");
  const [drawer, setDrawer] = useState<Recipe | null>(null);
  const listeners = useRef(new Set<(change: RecipeChange) => void>());
  const loading = useRef(false);
  const loaded = useRef(false);

  const load = useCallback(() => {
    if (loading.current || loaded.current) return;
    loading.current = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    getRecipes(null)
      .then(({ recipes: all }) => {
        loaded.current = true;
        setRecipes(all);
        setStatus("ready");
      })
      .catch(() => setStatus((current): LoadStatus => (current === "ready" ? current : "error")))
      .finally(() => {
        loading.current = false;
      });
  }, []);

  const prime = useCallback((all: Recipe[]) => {
    loaded.current = true;
    setRecipes(all);
    setStatus("ready");
  }, []);

  const notify = useCallback((change: RecipeChange) => {
    setRecipes((current) => applyChange(current, change));
    if (change.kind === "deleted") setDrawer((open) => (open?.id === change.id ? null : open));
    listeners.current.forEach((listener) => listener(change));
  }, []);

  const subscribe = useCallback((listener: (change: RecipeChange) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  // The drawer belongs to the page it was opened on.
  useEffect(() => {
    setDrawer(null);
  }, [pathname]);

  const value = useMemo<RecipeLibraryApi>(
    () => ({ recipes, status, load, prime, openRecipe: setDrawer, notify, subscribe }),
    [recipes, status, load, prime, notify, subscribe],
  );

  return (
    <RecipeLibraryContext.Provider value={value}>
      {children}
      {drawer && (
        <RecipeDrawer
          key={drawer.id}
          recipe={drawer}
          onClose={() => setDrawer(null)}
          onDeleted={(id) => notify({ kind: "deleted", id })}
          onAsk={(recipe) => {
            setDrawer(null);
            openChat({ recipe });
          }}
        />
      )}
    </RecipeLibraryContext.Provider>
  );
}
