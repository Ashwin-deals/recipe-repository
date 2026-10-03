import { describe, expect, it } from "vitest";
import { makeItem, makeRecipe } from "../test/fixtures";
import { MAX_QUERY, filterRecipes, highlight, queryTokens, searchItems, searchRecipes } from "./search";

const pancakes = makeRecipe({ id: 1, title: "Buttermilk Pancakes", lines: ["1 cup buttermilk", "2 eggs"], diet_tags: ["vegetarian"] });
const shakshuka = makeRecipe({ id: 2, title: "Shakshuka", category: "Breakfast", lines: ["4 eggs", "400 g tomatoes"], diet_tags: [] });
const curry = makeRecipe({ id: 3, title: "Egg Curry", category: "Dinner", lines: ["6 eggs", "1 onion"], diet_tags: ["gluten-free"] });

describe("queryTokens", () => {
  it("lower-cases, splits, de-duplicates and caps the length", () => {
    expect(queryTokens("  Eggs  TOMATOES eggs ")).toEqual(["eggs", "tomatoes"]);
    expect(queryTokens("")).toEqual([]);
    expect(queryTokens("a".repeat(MAX_QUERY + 50))[0]).toHaveLength(MAX_QUERY);
  });
});

describe("searchRecipes", () => {
  it("needs every word to match somewhere", () => {
    expect(searchRecipes([pancakes, shakshuka, curry], "eggs tomatoes").map((h) => h.recipe.id)).toEqual([2]);
    expect(searchRecipes([pancakes, shakshuka, curry], "eggs sushi")).toEqual([]);
    expect(searchRecipes([pancakes], "   ")).toEqual([]);
  });

  it("ranks title matches above ingredient matches", () => {
    expect(searchRecipes([pancakes, shakshuka, curry], "egg").map((h) => h.recipe.title)).toEqual(["Egg Curry", "Buttermilk Pancakes", "Shakshuka"]);
  });

  it("says where a non-title match came from", () => {
    const [hit] = searchRecipes([shakshuka], "tomatoes");
    expect(hit?.detail).toEqual({ field: "ingredient", text: "400 g tomatoes" });
    expect(searchRecipes([curry], "gluten")[0]?.detail).toEqual({ field: "tag", text: "gluten-free" });
    expect(searchRecipes([curry], "dinner")[0]?.detail).toEqual({ field: "category", text: "Dinner" });
    expect(searchRecipes([curry], "curry")[0]?.detail).toBeNull();
  });
});

describe("filterRecipes", () => {
  it("keeps the original order and returns everything for an empty query", () => {
    expect(filterRecipes([shakshuka, curry, pancakes], "egg").map((r) => r.id)).toEqual([2, 3, 1]);
    expect(filterRecipes([shakshuka, curry], "")).toHaveLength(2);
  });
});

describe("searchItems", () => {
  it("matches the whole line, best name match first", () => {
    const items = [
      makeItem({ id: 1, label: "2 cups flour", name: "flour" }),
      makeItem({ id: 2, label: "200 g self-raising flour", name: "self-raising flour" }),
      makeItem({ id: 3, label: "4 eggs", name: "eggs" }),
    ];
    expect(searchItems(items, "flour").map((h) => h.item.id)).toEqual([1, 2]);
    expect(searchItems(items, "2 cups").map((h) => h.item.id)).toEqual([1]);
  });
});

describe("highlight", () => {
  it("marks every match, case-insensitively, merging overlaps", () => {
    expect(highlight("Egg & eggplant", "egg")).toEqual([
      { text: "Egg", match: true },
      { text: " & ", match: false },
      { text: "egg", match: true },
      { text: "plant", match: false },
    ]);
    expect(highlight("Shakshuka", "shak hak")).toEqual([{ text: "Shak", match: true }, { text: "shuka", match: false }]);
    expect(highlight("Pancakes", "")).toEqual([{ text: "Pancakes", match: false }]);
  });

  it("treats the query as plain text, not a pattern", () => {
    expect(highlight("1/2 cup (sifted)", "(sifted)")).toEqual([{ text: "1/2 cup ", match: false }, { text: "(sifted)", match: true }]);
  });
});
