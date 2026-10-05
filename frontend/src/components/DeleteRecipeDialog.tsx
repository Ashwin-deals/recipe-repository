import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteRecipe, getListImpact, type ListImpact } from "../api/endpoints";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { deletedMessage, plural } from "../lib/messages";
import type { Recipe } from "../types";
import { Icon } from "./Icon";

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function impactText(impact: ListImpact): string {
  const total = impact.removed + impact.reduced;
  const came = `${plural(total, "item", "items")} on your list came from this recipe`;
  if (!impact.reduced) return `${came}.`;
  if (!impact.removed) {
    return `${came}. ${total === 1 ? "It is" : "They are"} shared with other recipes, so only this recipe's amount comes off.`;
  }
  return `${came}. ${plural(impact.reduced, "is", "are")} shared with other recipes, so only this recipe's amount comes off ${impact.reduced === 1 ? "it" : "them"}.`;
}

/**
 * Confirmation before deleting a recipe. It says how many list items come with it, then deletes
 * the recipe and takes its ingredients off the list in one request. Cancel, Esc or a click
 * outside leaves everything as it was. Stacks above the recipe drawer: Esc closes only this.
 */
export function DeleteRecipeDialog({ recipe, onClose, onDeleted }: {
  recipe: Recipe;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const ids = useId();
  const toast = useToast();
  const shopping = useShoppingList();
  const [impact, setImpact] = useState<ListImpact | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(false);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    let live = true;
    getListImpact(recipe.id)
      .then((result) => live && setImpact(result))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [recipe.id]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    // Capture on window so Esc and Tab are handled here before the drawer underneath sees them.
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      event.stopPropagation();
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const inside = panel.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteRecipe(recipe.id);
      toast.show(deletedMessage(recipe.title, result.list_removed, result.list_reduced));
      onDeleted(recipe.id);
      await shopping.reload();
    } catch (err) {
      busyRef.current = false;
      setBusy(false);
      setError(errorMessage(err));
    }
  }

  const none = impact !== null && impact.removed + impact.reduced === 0;
  // Rendered into <body>: inside the drawer, its transform would trap position: fixed.
  return createPortal(
    <div className="dialog-layer">
      <div className="dialog-backdrop" aria-hidden="true" onClick={() => !busyRef.current && onClose()} />
      <div
        ref={panel}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-body`}
      >
        <div className="dialog-head">
          <span className="dialog-icon" aria-hidden="true">
            <Icon name="trash" />
          </span>
          <h2 id={`${ids}-title`}>Delete “{recipe.title}”?</h2>
        </div>
        <div id={`${ids}-body`} className="dialog-body">
          {none ? (
            <p>None of its ingredients are on your shopping list, so only the recipe will be deleted.</p>
          ) : (
            <p>Deleting this recipe will also remove its ingredients from your shopping list.</p>
          )}
          <p className="dialog-impact" aria-live="polite">
            {impact === null && !failed && "Checking your list…"}
            {impact !== null && !none && impactText(impact)}
            {failed && "We couldn't check your list right now; its ingredients will still be removed."}
          </p>
          <p className="hint">It also leaves your meal plan. This can't be undone.</p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button ref={cancelButton} type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger-solid" onClick={() => void confirm()} aria-busy={busy}>
            <Icon name="trash" />
            {busy ? "Deleting…" : none ? "Delete recipe" : "Delete recipe and ingredients"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
