// Deterministic generated covers. A stable hash of the recipe picks a pattern, a palette from
// its category and a letter placement, so a recipe always looks the same but neighbours differ.

import type { Category } from "../types";

export type Pattern = "dots" | "stripes" | "rays" | "waves" | "checks" | "grain";
export const PATTERNS: Pattern[] = ["dots", "stripes", "rays", "waves", "checks", "grain"];

export interface Palette {
  bg: string;
  letter: string;
  /** Pattern marks, drawn at low opacity over the background. */
  ink: string;
  /** Category label chip that stands out best on this background. */
  chip: "dark" | "light";
}

// Every letter/background pair is at least 4.5:1 (checked in coverArt.test.ts).
export const PALETTES: Record<Category, Palette[]> = {
  Breakfast: [
    { bg: "#f4b400", letter: "#0f2a23", ink: "#ffffff", chip: "dark" },
    { bg: "#ffd45c", letter: "#7a3b00", ink: "#b36b00", chip: "dark" },
    { bg: "#0f2a23", letter: "#f4b400", ink: "#f4b400", chip: "light" },
    { bg: "#ff9a3c", letter: "#0f2a23", ink: "#ffe1b8", chip: "dark" },
  ],
  Lunch: [
    { bg: "#2563a8", letter: "#ffffff", ink: "#ffffff", chip: "light" },
    { bg: "#cfe3ff", letter: "#173f6e", ink: "#2563a8", chip: "dark" },
    { bg: "#0f2340", letter: "#8cc0ff", ink: "#8cc0ff", chip: "light" },
    { bg: "#6fb1ff", letter: "#0f2a23", ink: "#ffffff", chip: "dark" },
  ],
  Dinner: [
    { bg: "#1f6b4a", letter: "#c8f25c", ink: "#000000", chip: "light" },
    { bg: "#c8f25c", letter: "#1f6b4a", ink: "#1f6b4a", chip: "dark" },
    { bg: "#0e3b2b", letter: "#e6f4d8", ink: "#c8f25c", chip: "light" },
    { bg: "#8fd19e", letter: "#0f2a23", ink: "#ffffff", chip: "dark" },
  ],
  Dessert: [
    { bg: "#b3245f", letter: "#ffd3e4", ink: "#ffffff", chip: "light" },
    { bg: "#ffd3e4", letter: "#8f1747", ink: "#b3245f", chip: "dark" },
    { bg: "#4f0f2e", letter: "#ff9ec4", ink: "#ff9ec4", chip: "light" },
    { bg: "#e0528a", letter: "#2a0716", ink: "#ffffff", chip: "dark" },
  ],
};

/** Where the letter's box sits, as fractions of the cover. Kept clear of the top-left label
 *  (which takes at most ~45% of the width and ~28% of the height, even on a 160px card). */
export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  align: "xMidYMid" | "xMaxYMid" | "xMinYMax";
}

export const PLACEMENTS: Placement[] = [
  { x: 0.5, y: 0.08, w: 0.46, h: 0.84, align: "xMaxYMid" }, // right
  { x: 0.28, y: 0.3, w: 0.44, h: 0.64, align: "xMidYMid" }, // centre, below the label
  { x: 0.04, y: 0.34, w: 0.42, h: 0.6, align: "xMinYMax" }, // bottom left
];

const ROTATIONS = [-8, -4, 0, 3, 6];

/** 32-bit FNV-1a: small, fast and stable across sessions and browsers. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The first visible character (a whole grapheme, so emoji and accents survive), upper-cased when safe. */
export function initialOf(title: string): string {
  const text = title.trim();
  if (!text) return "?";
  let first = Array.from(text)[0] ?? "?";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segment = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next();
    if (!segment.done) first = segment.value.segment;
  }
  const upper = first.toLocaleUpperCase();
  // "ß" becomes "SS": keep a single glyph so the letter always fits its box.
  return Array.from(upper).length === Array.from(first).length ? upper : first;
}

export interface CoverArt {
  pattern: Pattern;
  palette: Palette;
  placement: Placement;
  rotation: number;
  /** Pattern scale and angle tweaks, so even equal patterns differ slightly. */
  scale: number;
  angle: number;
  initial: string;
}

export function coverArt(recipe: { id: number; title: string; category: Category }): CoverArt {
  const h = hash(`${recipe.id}:${recipe.title}`);
  const palettes = PALETTES[recipe.category];
  // Different bit ranges for each choice so they vary independently.
  return {
    pattern: PATTERNS[h % PATTERNS.length] as Pattern,
    palette: palettes[(h >>> 3) % palettes.length] as Palette,
    placement: PLACEMENTS[(h >>> 6) % PLACEMENTS.length] as Placement,
    rotation: ROTATIONS[(h >>> 9) % ROTATIONS.length] as number,
    scale: 0.8 + ((h >>> 12) % 5) * 0.1,
    angle: [35, 45, 60, 120, 135][(h >>> 15) % 5] as number,
    initial: initialOf(recipe.title),
  };
}
