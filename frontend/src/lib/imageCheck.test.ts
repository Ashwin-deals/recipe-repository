import { describe, expect, it } from "vitest";
import { checkImage } from "./imageCheck";

const MB = 1024 * 1024;
const file = (type: string, size: number) => new File([new Uint8Array(size)], "x", { type });

describe("checkImage", () => {
  it.each([
    ["image/jpeg", 10, null],
    ["image/png", 5 * MB, null],
    ["image/webp", 10, null],
    ["image/heic", 10, "Use a JPEG, PNG or WebP image."],
    ["application/pdf", 10, "Use a JPEG, PNG or WebP image."],
    ["image/jpeg", 0, "That file is empty."],
    ["image/jpeg", 5 * MB + 1, "That photo is over 5 MB. Try a smaller one."],
  ])("%s of %i bytes", (type, size, expected) => {
    expect(checkImage(file(type, size), 5 * MB)).toBe(expected);
  });
});
