import type { ListItem, Recipe } from "../types";

/** Longest query the search box accepts. */
export const MAX_QUERY = 100;

/** Lower-cased, de-duplicated words of a query. Every word must match for a result to count. */
export function queryTokens(query: string): string[] {
  return [...new Set(query.slice(0, MAX_QUERY).toLowerCase().split(/\s+/).filter(Boolean))];
}

export type MatchField = "ingredient" | "tag" | "category";

export interface RecipeHit {
  recipe: Recipe;
  score: number;
  /** Where the words not found in the title matched, e.g. the ingredient line. Null if the title says it all. */
  detail: { field: MatchField; text: string } | null;
}

export interface ItemHit {
  item: ListItem;
  score: number;
}

const startsWord = (text: string, token: string) => text.startsWith(token) || text.includes(` ${token}`);

function scoreRecipe(recipe: Recipe, tokens: string[]): RecipeHit | null {
  const title = recipe.title.toLowerCase();
  const tags = recipe.diet_tags.map((tag) => tag.toLowerCase());
  const category = recipe.category.toLowerCase();
  const lines = recipe.lines.map((line) => line.toLowerCase());
  let score = 0;
  let detail: RecipeHit["detail"] = null;

  for (const token of tokens) {
    if (title.includes(token)) {
      score += startsWord(title, token) ? 30 : 20;
      continue;
    }
    const tag = tags.findIndex((t) => t.includes(token));
    if (tag >= 0) {
      score += 12;
      detail ??= { field: "tag", text: recipe.diet_tags[tag] ?? "" };
      continue;
    }
    if (category.includes(token)) {
      score += 12;
      detail ??= { field: "category", text: recipe.category };
      continue;
    }
    const line = lines.findIndex((l) => l.includes(token));
    if (line < 0) return null;
    score += startsWord(lines[line] ?? "", token) ? 8 : 6;
    detail ??= { field: "ingredient", text: recipe.lines[line] ?? "" };
  }
  if (tokens.length && title.startsWith(tokens.join(" "))) score += 20;
  return { recipe, score, detail };
}

/** Recipes matching every word, best first: title matches beat tags and categories, which beat ingredients. */
export function searchRecipes(recipes: readonly Recipe[], query: string): RecipeHit[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  return recipes
    .map((recipe) => scoreRecipe(recipe, tokens))
    .filter((hit): hit is RecipeHit => hit !== null)
    .sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title));
}

/** Same match rule as searchRecipes, but keeps the original order (for filtering the recipe grid). */
export function filterRecipes(recipes: readonly Recipe[], query: string): Recipe[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [...recipes];
  return recipes.filter((recipe) => scoreRecipe(recipe, tokens) !== null);
}

/** Shopping list items whose line contains every word. */
export function searchItems(items: readonly ListItem[], query: string): ItemHit[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const hits: ItemHit[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    if (!tokens.every((token) => label.includes(token))) continue;
    const name = item.name.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (startsWord(name, token) ? 2 : name.includes(token) ? 1 : 0), 0);
    hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
}

export interface Segment {
  text: string;
  match: boolean;
}

/** Split text into plain and matched parts, for rendering matches with <mark>. */
export function highlight(text: string, query: string): Segment[] {
  const tokens = queryTokens(query);
  const lower = text.toLowerCase();
  // Some characters change length when lower-cased; don't risk misplaced marks for those.
  if (!tokens.length || lower.length !== text.length) return [{ text, match: false }];

  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    for (let at = lower.indexOf(token); at >= 0; at = lower.indexOf(token, at + token.length)) {
      ranges.push([at, at + token.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    const from = Math.max(start, cursor);
    if (from > cursor) segments.push({ text: text.slice(cursor, from), match: false });
    const last = segments[segments.length - 1];
    if (last?.match && from === cursor) last.text += text.slice(from, end);
    else segments.push({ text: text.slice(from, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
