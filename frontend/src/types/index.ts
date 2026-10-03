// Shapes of the Flask JSON API. Field names match the backend exactly.

export type Category = "Breakfast" | "Lunch" | "Dinner" | "Dessert";
export type Source = "ai" | "basic";

export interface Nutrition {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  servings: number | null;
  estimate: true;
}

export interface Recipe {
  id: number;
  title: string;
  prep_time: number;
  category: Category;
  ingredients: string;
  lines: string[];
  nutrition: Nutrition | null;
  diet_tags: string[];
  created_at: string;
}

export interface AppConfig {
  ai_enabled: boolean;
  categories: Category[];
  days: string[];
  multipliers: number[];
  max_image_bytes: number;
}

export interface ListItem {
  id: number;
  label: string;
  amount: string;
  name: string;
  aisle: string;
  checked: boolean;
  sources: string[];
}

export interface ListGroup {
  aisle: string;
  items: ListItem[];
}

export interface Counts {
  total: number;
  checked: number;
  open: number;
}

export interface ListData {
  groups: ListGroup[];
  counts: Counts;
}

export interface AddResult {
  added: number;
  merged: number;
  counts: Counts;
}

export interface ScaledLines {
  multiplier: number;
  lines: string[];
}

export interface PlanEntry {
  id: number;
  day: string;
  multiplier: number;
  recipe_id: number;
  title: string;
  category: Category;
  prep_time: number;
}

export interface PlanData {
  plan: Record<string, PlanEntry[]>;
  days: string[];
}

export interface BuildResult extends AddResult {
  meals: number;
}

export interface Bar {
  label: string;
  count: number;
  percent: number;
}

export interface CategoryTrend {
  label: Category;
  saved: number;
  added: number;
  recent: number;
  saved_percent: number;
  added_percent: number;
}

export interface InsightsData {
  top_recipes: Bar[];
  top_items: Bar[];
  categories: CategoryTrend[];
  counts: { recipes: number; open_items: number; lists_built: number; trips: number };
  ai_calls: number;
  ai_cap: number;
  looker_url: string | null;
}

export interface RecipeDraft {
  title: string;
  prep_time: number | null;
  category: Category;
  ingredients: string[];
}

export interface ImportResult {
  recipe: RecipeDraft;
  source: "gemini" | "fallback";
  message: string;
}

export interface NutritionResult {
  nutrition: Nutrition | null;
  diet_tags: string[];
  source: Source;
  message: string;
}

export interface Substitute {
  swap: string;
  note: string;
}

export interface SubstituteResult {
  ingredient: string;
  substitutes: Substitute[];
  source: Source;
  message: string | null;
}
