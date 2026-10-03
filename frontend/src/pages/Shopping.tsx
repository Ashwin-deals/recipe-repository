import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ShoppingList } from "../components/ShoppingList";
import { usePageTitle } from "../hooks/usePageTitle";
import { useShoppingList } from "../hooks/useShoppingList";

export function Shopping() {
  usePageTitle("Shopping list");
  const { state } = useLocation() as { state: { highlightItem?: number } | null };
  const { status } = useShoppingList();
  const target = state?.highlightItem;

  // Arriving from search: bring the chosen item into view and flash it.
  useEffect(() => {
    if (target === undefined || status !== "ready") return;
    const row = document.querySelector<HTMLElement>(`.list-page [data-item-id="${target}"]`);
    if (!row) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Next frame: the layout moves focus to <main> after a navigation, which would undo ours.
    const frame = window.requestAnimationFrame(() => {
      row.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
      row.querySelector("button")?.focus({ preventScroll: true });
      row.classList.add("is-found");
    });
    const timer = window.setTimeout(() => row.classList.remove("is-found"), 2000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [target, status]);

  return (
    <div className="list-page">
      <ShoppingList variant="full" />
    </div>
  );
}
