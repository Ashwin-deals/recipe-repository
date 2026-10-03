/**
 * Fly a few ingredient chips from `from` to the visible cart target ([data-cart-target]),
 * then bump it. Purely decorative: skipped for reduced motion or without the Web Animations API.
 */
export function flyToCart(from: Element, labels: string[]): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (typeof Element.prototype.animate !== "function") return;
  // Prefer the receipt or the floating cart ("primary"), then the List tab ("secondary"),
  // using the first one that is actually visible on screen.
  const onScreen = (el: HTMLElement) => {
    if (el.getClientRects().length === 0) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  };
  const targets = [...document.querySelectorAll<HTMLElement>("[data-cart-target]")];
  const target =
    targets.find((el) => el.dataset.cartTarget === "primary" && onScreen(el)) ??
    targets.find((el) => el.dataset.cartTarget === "secondary" && onScreen(el));
  if (!target) return;

  const start = from.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  const x0 = start.left + start.width / 2;
  const y0 = start.top + start.height / 2;
  const dx = end.left + end.width / 2 - x0;
  const dy = end.top + end.height / 2 - y0;
  const chips = labels.slice(0, 6);
  const duration = 620;
  const stagger = 55;

  chips.forEach((label, i) => {
    const chip = document.createElement("span");
    chip.className = "fly-chip";
    chip.textContent = label;
    chip.setAttribute("aria-hidden", "true");
    chip.style.left = `${x0}px`;
    chip.style.top = `${y0}px`;
    document.body.append(chip);
    const animation = chip.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 - 70}px)) scale(0.85)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.2)`, opacity: 0.1 },
      ],
      { duration, delay: i * stagger, easing: "cubic-bezier(.55,0,.6,1)", fill: "forwards" },
    );
    const remove = () => chip.remove();
    animation.onfinish = remove;
    animation.oncancel = remove;
  });

  window.setTimeout(() => {
    target.classList.remove("is-bumped");
    void target.offsetWidth; // restart the bump animation
    target.classList.add("is-bumped");
  }, duration + chips.length * stagger - 120);
}
