import type { CSSProperties } from "react";
import type { Recipe } from "../types";
import { DietTags } from "./DietTags";
import { Icon } from "./Icon";
import { RecipeCover } from "./RecipeCover";

interface RecipeCardProps {
  recipe: Recipe;
  index: number;
  onOpen: (recipe: Recipe) => void;
  onAsk: (recipe: Recipe) => void;
}

/**
 * Compact, fixed-shape card: cover, a two-line title, one line of meta, one row of tags and the
 * chef button. Every card has the same height; details open in the drawer, never inside the card.
 */
export function RecipeCard({ recipe, index, onOpen, onAsk }: RecipeCardProps) {
  return (
    <article
      className={`recipe-card cat-${recipe.category.toLowerCase()}`}
      id={`recipe-${recipe.id}`}
      style={{ "--i": Math.min(index, 12) } as CSSProperties}
    >
      <RecipeCover recipe={recipe} />
      <div className="card-body">
        <h2 className="recipe-title">
          {/* The button stretches over the whole card (see .recipe-title button::after). */}
          <button type="button" data-open-recipe aria-haspopup="dialog" onClick={() => onOpen(recipe)}>
            <span className="recipe-title-text">{recipe.title}</span>
          </button>
        </h2>
        <p className="card-meta">
          <span>
            <Icon name="clock" /> <span className="num">{recipe.prep_time}</span> min
          </span>
          <span>
            <span className="num">{recipe.lines.length}</span> ingredients
          </span>
        </p>
        {/* Always rendered, so cards with and without tags are the same height. */}
        <div className="card-tags">
          <DietTags tags={recipe.diet_tags} max={2} />
        </div>
        <button type="button" className="card-ask" onClick={() => onAsk(recipe)} aria-label={`Ask the chef about ${recipe.title}`}>
          <Icon name="chat" /> Ask the chef
        </button>
      </div>
    </article>
  );
}
