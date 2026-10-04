import { useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CategoryFilter } from "../components/CategoryFilter";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { RecipeCard } from "../components/RecipeCard";
import { RecipeForm } from "../components/RecipeForm";
import { ShoppingList } from "../components/ShoppingList";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Welcome } from "../components/Welcome";
import { AuthContext } from "../hooks/useAuth";
import { usePageTitle } from "../hooks/usePageTitle";
import { useRecipeChanges, useRecipeLibrary } from "../hooks/useRecipeLibrary";
import { useRecipes } from "../hooks/useRecipes";
import { useToast } from "../hooks/useToast";
import { filterRecipes } from "../lib/search";
import type { Category } from "../types";

const CATEGORIES: readonly string[] = ["Breakfast", "Lunch", "Dinner", "Dessert"];

function toCategory(value: string | null): Category | null {
  return value && CATEGORIES.includes(value) ? (value as Category) : null;
}

export function Dashboard() {
  usePageTitle("Recipes");
  const toast = useToast();
  const { openRecipe, prime, notify } = useRecipeLibrary();
  const [params, setParams] = useSearchParams();
  const category = toCategory(params.get("category"));
  const query = (params.get("q") ?? "").trim();
  const recipes = useRecipes(category);
  const [showForm, setShowForm] = useState(false);
  const { data, setData, reload } = recipes;
  const auth = useContext(AuthContext);

  // The unfiltered list is every recipe: share it with search so it doesn't fetch them again.
  useEffect(() => {
    if (!category && data) prime(data);
  }, [category, data, prime]);

  useRecipeChanges((change) => {
    if (change.kind === "deleted") setData((current) => current && current.filter((r) => r.id !== change.id));
    else void reload();
  });

  const visible = useMemo(() => (data && query ? filterRecipes(data, query) : data), [data, query]);

  const updateParams = (key: "category" | "q", value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const clearSearch = () => updateParams("q", null);

  const newRecipeButton = (label: string) => (
    <button className="btn btn-primary" type="button" onClick={() => setShowForm(true)}>
      <Icon name="plus" />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="dashboard">
      <section className="pane-recipes" aria-labelledby="recipes-heading">
        <PageHeader eyebrow="No. 01 · Recipe box" title="What's cooking this week?" id="recipes-heading">
          {!showForm && newRecipeButton("New recipe")}
        </PageHeader>

        {auth?.isNewAccount && !showForm && (
          <Welcome
            recipeCount={data?.length ?? 0}
            onSnap={() => {
              auth.dismissWelcome();
              setShowForm(true);
            }}
          />
        )}

        {showForm && (
          <RecipeForm
            onCancel={() => setShowForm(false)}
            onSaved={(recipe) => {
              setShowForm(false);
              toast.show(`Saved “${recipe.title}”.`);
              notify({ kind: "saved", recipe, replaced: false });
            }}
          />
        )}

        <CategoryFilter value={category} onChange={(next) => updateParams("category", next)} />

        {query && data && (
          <p className="search-summary" role="status">
            <span>
              Showing <strong className="num">{visible?.length ?? 0}</strong> of <span className="num">{data.length}</span>{" "}
              {category ? `${category.toLowerCase()} ` : ""}recipes for “{query}”
            </span>
            <button type="button" className="btn-text search-summary-clear" onClick={clearSearch}>
              Clear search
            </button>
          </p>
        )}

        {recipes.status === "loading" && <LoadingState label="Loading recipes…" kind="cards" />}
        {recipes.status === "error" && (
          <ErrorState message={recipes.error ?? "Couldn't load recipes."} onRetry={() => void reload()} />
        )}
        {visible && visible.length > 0 && (
          <div className="recipe-grid">
            {visible.map((recipe, index) => (
              <RecipeCard key={recipe.id} recipe={recipe} index={index} onOpen={openRecipe} />
            ))}
          </div>
        )}
        {data && data.length > 0 && visible?.length === 0 && (
          <EmptyState illustration="pot">
            <p>No recipes match “{query}”{category ? ` in ${category}` : ""}.</p>
            <button className="btn btn-ghost" type="button" onClick={clearSearch}>
              Clear search
            </button>
          </EmptyState>
        )}
        {data?.length === 0 && (
          <EmptyState illustration="pot">
            <p>{category ? `No ${category.toLowerCase()} recipes yet.` : "Your recipe box is empty."}</p>
            {!showForm && newRecipeButton("Add a recipe")}
          </EmptyState>
        )}
      </section>

      <aside className="pane-list" aria-label="Shopping list">
        <ShoppingList variant="panel" />
      </aside>
    </div>
  );
}
