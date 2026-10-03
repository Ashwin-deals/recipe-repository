import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CategoryFilter } from "../components/CategoryFilter";
import { ChatPanel } from "../components/ChatPanel";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { RecipeCard } from "../components/RecipeCard";
import { RecipeDrawer } from "../components/RecipeDrawer";
import { RecipeForm } from "../components/RecipeForm";
import { ShoppingList } from "../components/ShoppingList";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { usePageTitle } from "../hooks/usePageTitle";
import { useRecipes } from "../hooks/useRecipes";
import { useToast } from "../hooks/useToast";
import type { Category, Recipe } from "../types";

const CATEGORIES: readonly string[] = ["Breakfast", "Dinner", "Dessert"];

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
  const [open, setOpen] = useState<Recipe | null>(null);
  // null: closed; { recipe: null }: general chat; { recipe }: chat about that recipe.
  const [chat, setChat] = useState<{ recipe: Recipe | null } | null>(null);
  const askAbout = (recipe: Recipe | null) => {
    setOpen(null);
    setChat({ recipe });
  };

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
          <button className="btn btn-ghost" type="button" onClick={() => askAbout(null)}>
            <Icon name="chat" />
            <span>Ask the chef</span>
          </button>
          {!showForm && newRecipeButton("New recipe")}
        </PageHeader>

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

        {recipes.status === "loading" && <LoadingState label="Loading recipes…" kind="cards" />}
        {recipes.status === "error" && (
          <ErrorState message={recipes.error ?? "Couldn't load recipes."} onRetry={() => void recipes.reload()} />
        )}
        {recipes.data && recipes.data.length > 0 && (
          <div className="recipe-grid">
            {recipes.data.map((recipe, index) => (
              <RecipeCard key={recipe.id} recipe={recipe} index={index} onOpen={setOpen} onAsk={askAbout} />
            ))}
          </div>
        )}
        {recipes.data?.length === 0 && (
          <EmptyState illustration="pot">
            <p>{category ? `No ${category.toLowerCase()} recipes yet.` : "Your recipe box is empty."}</p>
            {!showForm && newRecipeButton("Add a recipe")}
          </EmptyState>
        )}
      </section>

      <aside className="pane-list" aria-label="Shopping list">
        <ShoppingList variant="panel" />
      </aside>

      {open && (
        <RecipeDrawer
          key={open.id}
          recipe={open}
          onClose={() => setOpen(null)}
          onDeleted={(id) => {
            setOpen(null);
            recipes.setData((current) => current && current.filter((r) => r.id !== id));
          }}
          onAsk={askAbout}
        />
      )}

      {chat && (
        <ChatPanel
          key={chat.recipe?.id ?? "general"}
          recipe={chat.recipe}
          onClose={() => setChat(null)}
          onRecipeSaved={() => void recipes.reload()}
        />
      )}
    </div>
  );
}
