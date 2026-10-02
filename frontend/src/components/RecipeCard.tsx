import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addRecipeToList, deleteRecipe, getScaled } from "../api/endpoints";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { addedMessage } from "../lib/messages";
import type { Recipe } from "../types";
import { ConfirmButton } from "./ConfirmButton";
import { DietTags } from "./DietTags";
import { Icon } from "./Icon";
import { ServingsSelect } from "./ServingsSelect";

interface RecipeCardProps {
  recipe: Recipe;
  onDeleted: (id: number) => void;
}

export function RecipeCard({ recipe, onDeleted }: RecipeCardProps) {
  const toast = useToast();
  const shopping = useShoppingList();
  const [multiplier, setMultiplier] = useState(1);
  const [lines, setLines] = useState(recipe.lines);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const latestScale = useRef(0);

  async function changeServings(next: number) {
    setMultiplier(next);
    setOpen(true);
    const requestId = ++latestScale.current;
    try {
      const scaled = next === 1 ? recipe.lines : (await getScaled(recipe.id, next)).lines;
      if (requestId === latestScale.current) setLines(scaled);
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    }
  }

  async function addToList() {
    setAdding(true);
    try {
      const result = await addRecipeToList(recipe.id, multiplier);
      toast.show(addedMessage(result));
      await shopping.reload();
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    try {
      await deleteRecipe(recipe.id);
      toast.show(`Deleted “${recipe.title}”.`);
      onDeleted(recipe.id);
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    }
  }

  return (
    <article className={`recipe-card cat-${recipe.category.toLowerCase()}`} id={`recipe-${recipe.id}`}>
      <div className="card-top">
        <span className={`tag tag-${recipe.category.toLowerCase()}`}>{recipe.category}</span>
        <span className="meta">
          <Icon name="clock" /> {recipe.prep_time} min
        </span>
      </div>
      <h2 className="recipe-title">
        <Link to={`/recipes/${recipe.id}`}>{recipe.title}</Link>
      </h2>
      <DietTags tags={recipe.diet_tags} />
      <details className="ingredients" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          {recipe.lines.length} ingredients
          {multiplier !== 1 && <span className="scale-badge">×{multiplier}</span>}
        </summary>
        <ul className="lines" aria-label={`Ingredients for ${recipe.title}`}>
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      </details>
      <div className="card-actions">
        <ServingsSelect value={multiplier} onChange={(m) => void changeServings(m)} recipeTitle={recipe.title} />
        <button className="btn btn-primary" type="button" onClick={() => void addToList()} disabled={adding}>
          <Icon name="cart" />
          <span>{adding ? "Adding…" : "Add to list"}</span>
        </button>
      </div>
      <div className="card-footer">
        <ConfirmButton className="btn-text" confirmLabel="Tap again to delete" onConfirm={() => void remove()}>
          Delete
        </ConfirmButton>
      </div>
    </article>
  );
}
