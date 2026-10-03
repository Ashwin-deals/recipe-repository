import { describe, expect, it } from "vitest";
import type { Category } from "../types";
import { coverArt, hash, initialOf, PALETTES, PLACEMENTS } from "./coverArt";

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("initialOf", () => {
  it.each([
    ["Warm Apple Crumble", "W"],
    ["mango lassi", "M"],
    ["7-Minute Eggs", "7"],
    ["éclair au chocolat", "É"],
    ["Øllebrød", "Ø"],
    ["🍓 Strawberry Fool", "🍓"],
    ["👩‍🍳 Chef's special", "👩‍🍳"], // a single emoji made of several code points
    ["ßpätzle", "ß"], // would become "SS": keep one glyph
    ["   spaced out", "S"],
    ["", "?"],
  ])("%s → %s", (title, initial) => {
    expect(initialOf(title)).toBe(initial);
  });
});

describe("coverArt", () => {
  it("is deterministic for the same recipe", () => {
    const recipe = { id: 42, title: "Chicken Tikka Curry", category: "Dinner" as Category };
    expect(coverArt(recipe)).toEqual(coverArt({ ...recipe }));
    expect(hash("abc")).toBe(hash("abc"));
  });

  it("varies within a category and stays in that category's palette", () => {
    const covers = Array.from({ length: 12 }, (_, i) => coverArt({ id: i + 1, title: `Dinner ${i}`, category: "Dinner" }));
    const looks = new Set(covers.map((c) => `${c.pattern}|${c.palette.bg}|${c.placement.align}`));
    expect(looks.size).toBeGreaterThanOrEqual(8);
    expect(new Set(covers.map((c) => c.pattern)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(covers.map((c) => c.palette.bg)).size).toBeGreaterThanOrEqual(3);
    for (const c of covers) expect(PALETTES.Dinner).toContain(c.palette);
  });

  it("keeps every letter readable on its background", () => {
    for (const [category, palettes] of Object.entries(PALETTES)) {
      for (const p of palettes) {
        expect(contrast(p.letter, p.bg), `${category} ${p.bg}`).toBeGreaterThanOrEqual(4.5);
        const chip = p.chip === "dark" ? "#0f2a23" : "#f1f5ee";
        const other = p.chip === "dark" ? "#f1f5ee" : "#0f2a23";
        expect(contrast(chip, p.bg)).toBeGreaterThan(contrast(other, p.bg)); // the more visible chip
      }
    }
  });

  it("keeps the letter box inside the frame and clear of the top-left label", () => {
    for (const p of PLACEMENTS) {
      expect(p.x).toBeGreaterThanOrEqual(0.03);
      expect(p.y).toBeGreaterThanOrEqual(0.06);
      expect(p.x + p.w).toBeLessThanOrEqual(0.97);
      expect(p.y + p.h).toBeLessThanOrEqual(0.95);
      expect(p.x >= 0.45 || p.y >= 0.28).toBe(true); // the label occupies at most x < 45%, y < 28%
    }
  });
});
