import { getRecipes } from "../api/endpoints";
import type { Category, Recipe } from "../types";
import { useApi, type ApiState } from "./useApi";

export function useRecipes(category: Category | null): ApiState<Recipe[]> {
  return useApi(`recipes:${category ?? "all"}`, async () => (await getRecipes(category)).recipes);
}
