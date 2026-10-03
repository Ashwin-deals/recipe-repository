import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CategoryFilter } from "../components/CategoryFilter";
import { Icon } from "../components/Icon";
import { RecipeCard } from "../components/RecipeCard";
import { RecipeForm } from "../components/RecipeForm";
import { ShoppingList } from "../components/ShoppingList";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { usePageTitle } from "../hooks/usePageTitle";
import { useRecipes } from "../hooks/useRecipes";
import { useToast } from "../hooks/useToast";
import type { Category } from "../types";

const CATEGORIES: readonly string[] = ["Breakfast", "Lunch", "Dinner", "Dessert"];

function toCategory(value: string | null): Category | null {
  return value && CATEGORIES.includes(value) ? (value as Category) : null;
}

export function Dashboard() {
  usePageTitle("Recipes");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const category = toCategory(params.get("category"));
  const recipes = useRecipes(category);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="dashboard">
      <section className="pane pane-recipes" aria-labelledby="recipes-heading">
        <div className="pane-head">
          <div>
            <p className="eyebrow">Recipe box</p>
            <h1 id="recipes-heading">What's cooking this week?</h1>
          </div>
          {!showForm && (
            <button className="btn btn-primary" type="button" onClick={() => setShowForm(true)}>
              <Icon name="plus" />
              <span>New recipe</span>
            </button>
          )}
        </div>

        {showForm && (
          <RecipeForm
            onCancel={() => setShowForm(false)}
            onSaved={(recipe) => {
              setShowForm(false);
              toast.show(`Saved “${recipe.title}”.`);
              void recipes.reload();
            }}
          />
        )}

        <CategoryFilter
          value={category}
          onChange={(next) => setParams(next ? { category: next } : {}, { replace: true })}
        />

        {recipes.status === "loading" && <LoadingState label="Loading recipes…" />}
        {recipes.status === "error" && (
          <ErrorState message={recipes.error ?? "Couldn't load recipes."} onRetry={() => void recipes.reload()} />
        )}
        {recipes.data && recipes.data.length > 0 && (
          <div className="card-grid">
            {recipes.data.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onDeleted={(id) => recipes.setData((current) => current && current.filter((r) => r.id !== id))}
              />
            ))}
          </div>
        )}
        {recipes.data?.length === 0 && (
          <EmptyState>
            <p>{category ? `No ${category.toLowerCase()} recipes yet.` : "Your recipe box is empty."}</p>
            {!showForm && (
              <button className="btn btn-primary" type="button" onClick={() => setShowForm(true)}>
                <Icon name="plus" />
                <span>Add a recipe</span>
              </button>
            )}
          </EmptyState>
        )}
      </section>

      <aside className="pane pane-list" aria-label="Shopping list">
        <ShoppingList variant="panel" />
      </aside>
    </div>
  );
}
