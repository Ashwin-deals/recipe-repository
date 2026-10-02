import type {
  AddResult, AppConfig, BuildResult, Category, Counts, ImportResult, InsightsData, ListData,
  NutritionResult, PlanData, Recipe, ScaledLines, SubstituteResult,
} from "../types";
import { api } from "./client";

export const getConfig = () => api.get<AppConfig>("/api/config");

export const getRecipes = (category: Category | null) =>
  api.get<{ recipes: Recipe[] }>(category ? `/api/recipes?category=${encodeURIComponent(category)}` : "/api/recipes");

export const getRecipe = (id: number) => api.get<{ recipe: Recipe }>(`/api/recipes/${id}`);

export interface RecipeInput {
  title: string;
  prep_time: string;
  category: string;
  ingredients: string;
}

export const createRecipe = (input: RecipeInput) => api.post<{ recipe: Recipe }>("/api/recipes", input);

export const deleteRecipe = (id: number) => api.delete<{ deleted: number }>(`/api/recipes/${id}`);

export const getScaled = (id: number, multiplier: number) =>
  api.get<ScaledLines>(`/api/recipes/${id}/scaled?x=${multiplier}`);

export const addRecipeToList = (id: number, multiplier: number) =>
  api.post<AddResult>(`/api/recipes/${id}/add-to-list`, { multiplier });

export const getList = () => api.get<ListData>("/api/list");

export const addListItem = (line: string) => api.post<AddResult>("/api/list/items", { line });

export const setItemChecked = (id: number, checked: boolean) =>
  api.post<{ id: number; checked: boolean; counts: Counts }>(`/api/list/${id}/check`, { checked });

export const clearList = (scope: "all" | "checked") =>
  api.post<{ removed: number; scope: string; counts: Counts }>("/api/list/clear", { scope });

export const getPlanner = () => api.get<PlanData>("/api/planner");

export const addToPlan = (day: string, recipeId: number, multiplier: number) =>
  api.post<PlanData & { entry_id: number }>("/api/planner", { day, recipe_id: recipeId, multiplier });

export const removeFromPlan = (entryId: number) => api.delete<PlanData>(`/api/planner/${entryId}`);

export const clearPlan = () => api.post<PlanData & { removed: number }>("/api/planner/clear");

export const buildPlanList = () => api.post<BuildResult>("/api/planner/build");

export const getInsights = () => api.get<InsightsData>("/api/insights");

export const importRecipe = ({ image, text }: { image?: File | null; text?: string }) => {
  const form = new FormData();
  if (image) form.append("image", image);
  if (text?.trim()) form.append("text", text);
  return api.postForm<ImportResult>("/api/import", form);
};

export const estimateNutrition = (id: number) => api.post<NutritionResult>(`/api/recipes/${id}/nutrition`);

export const suggestSubstitutes = (ingredient: string, recipeId?: number) =>
  api.post<SubstituteResult>("/api/substitute", { ingredient, recipe_id: recipeId ?? null });
