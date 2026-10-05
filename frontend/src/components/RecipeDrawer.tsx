import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addRecipeToList, getScaled } from "../api/endpoints";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { flyToCart } from "../lib/flyToCart";
import { addedMessage } from "../lib/messages";
import type { Recipe } from "../types";
import { DeleteRecipeDialog } from "./DeleteRecipeDialog";
import { DietTags } from "./DietTags";
import { Icon } from "./Icon";
import { RecipeCover } from "./RecipeCover";
import { ServingsSelect } from "./ServingsSelect";
import { Sheet } from "./Sheet";

interface RecipeDrawerProps {
  recipe: Recipe;
  onClose: () => void;
  onDeleted: (id: number) => void;
  onAsk: (recipe: Recipe) => void;
}

/**
 * Quick view for a recipe: servings scaler, scaled ingredients (from the backend), Add to list
 * and delete. A side drawer on desktop, a bottom sheet on phones; it overlays the page, so the
 * recipe grid never reflows.
 */
export function RecipeDrawer({ recipe, onClose, onDeleted, onAsk }: RecipeDrawerProps) {
  const toast = useToast();
  const shopping = useShoppingList();
  const [multiplier, setMultiplier] = useState(1);
  const [lines, setLines] = useState(recipe.lines);
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const latestScale = useRef(0);
  const addButton = useRef<HTMLButtonElement>(null);

  async function changeServings(next: number) {
    setMultiplier(next);
    const requestId = ++latestScale.current;
    try {
      const scaled = next === 1 ? recipe.lines : (await getScaled(recipe.id, next)).lines;
      if (requestId === latestScale.current) setLines(scaled);
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    }
  }

  async function addToList() {
    if (adding) return; // busy, not disabled: disabling would drop keyboard focus
    setAdding(true);
    try {
      const result = await addRecipeToList(recipe.id, multiplier);
      if (addButton.current) flyToCart(addButton.current, lines);
      toast.show(addedMessage(result));
      await shopping.reload();
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    } finally {
      setAdding(false);
    }
  }

  const titleId = `drawer-title-${recipe.id}`;
  return (
    <Sheet labelledBy={titleId} onClose={onClose} className={`cat-${recipe.category.toLowerCase()}`}>
        <header className="drawer-head">
          <RecipeCover recipe={recipe} size="strip" />
          <button type="button" className="drawer-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
          <p className="eyebrow">
            {recipe.category} · <span className="num">{recipe.prep_time}</span> min prep
          </p>
          <h2 id={titleId} className="drawer-title">
            {recipe.title}
          </h2>
          <DietTags tags={recipe.diet_tags} />
        </header>

        <div className="drawer-body">
          <div className="drawer-scaler">
            <ServingsSelect value={multiplier} onChange={(m) => void changeServings(m)} recipeTitle={recipe.title} />
            {multiplier !== 1 && <span className="scale-badge">×{multiplier}</span>}
          </div>
          <ul className="lines" aria-label={`Ingredients for ${recipe.title}`}>
            {lines.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        </div>

        <footer className="drawer-foot">
          <button ref={addButton} className="btn btn-primary btn-block" type="button" onClick={() => void addToList()} aria-busy={adding}>
            <Icon name="cart" />
            <span>{adding ? "Adding…" : "Add to list"}</span>
          </button>
          <div className="drawer-links">
            <Link className="link-arrow" to={`/recipes/${recipe.id}`} onClick={onClose}>
              Full recipe, nutrition &amp; swaps <Icon name="arrow" />
            </Link>
            <button type="button" className="link-arrow btn-link" onClick={() => onAsk(recipe)}>
              <Icon name="chat" /> Ask about this recipe
            </button>
            <button type="button" className="btn-text" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          </div>
        </footer>
        {confirmingDelete && (
          <DeleteRecipeDialog recipe={recipe} onClose={() => setConfirmingDelete(false)} onDeleted={onDeleted} />
        )}
    </Sheet>
  );
}
