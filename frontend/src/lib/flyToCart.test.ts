import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flyToCart } from "./flyToCart";

function target(kind: string) {
  const el = document.createElement("div");
  el.dataset.cartTarget = kind;
  el.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
  el.getBoundingClientRect = () => new DOMRect(300, 40, 40, 40);
  document.body.append(el);
  return el;
}

describe("flyToCart", () => {
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    animate = vi.fn(() => ({ onfinish: null, oncancel: null }));
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    delete (Element.prototype as Partial<Element>).animate;
  });

  it("flies up to six chips and bumps the primary target over the List tab", () => {
    const secondary = target("secondary");
    const primary = target("primary");
    const from = document.createElement("button");
    document.body.append(from);
    flyToCart(from, ["1 egg", "2 cups flour", "a", "b", "c", "d", "e", "f"]);
    expect(document.querySelectorAll(".fly-chip")).toHaveLength(6);
    expect(animate).toHaveBeenCalledTimes(6);
    vi.runAllTimers();
    expect(primary.classList.contains("is-bumped")).toBe(true);
    expect(secondary.classList.contains("is-bumped")).toBe(false);
  });

  it("does nothing when the user prefers reduced motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    target("primary");
    flyToCart(document.body, ["1 egg"]);
    expect(document.querySelectorAll(".fly-chip")).toHaveLength(0);
    delete (window as Partial<Window>).matchMedia;
  });
});
