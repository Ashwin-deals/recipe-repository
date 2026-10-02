import type { ListData, ListItem, Recipe } from "../types";

export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  const lines = overrides.lines ?? ["1 1/2 cups flour", "1 egg", "salt to taste"];
  return {
    id: 1,
    title: "Pancakes",
    prep_time: 20,
    category: "Breakfast",
    ingredients: lines.join("\n"),
    lines,
    nutrition: null,
    diet_tags: ["vegetarian"],
    created_at: "2026-10-01 10:00:00",
    ...overrides,
  };
}

export function makeItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    id: 5,
    label: "2 cups flour",
    amount: "2 cups",
    name: "flour",
    aisle: "Pantry",
    checked: false,
    sources: ["Pancakes"],
    ...overrides,
  };
}

export function makeList(items: ListItem[] = []): ListData {
  const aisles = [...new Set(items.map((item) => item.aisle))];
  const checked = items.filter((item) => item.checked).length;
  return {
    groups: aisles.map((aisle) => ({ aisle, items: items.filter((item) => item.aisle === aisle) })),
    counts: { total: items.length, checked, open: items.length - checked },
  };
}
