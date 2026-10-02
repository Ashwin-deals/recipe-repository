import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addRecipeToList, deleteRecipe, estimateNutrition, getRecipe, getScaled, suggestSubstitutes } from "../api/endpoints";
import { ConfirmButton } from "../components/ConfirmButton";
import { DietTags } from "../components/DietTags";
import { Icon } from "../components/Icon";
import { ServingsSelect } from "../components/ServingsSelect";
import { ErrorState, LoadingState } from "../components/States";
import { useApi } from "../hooks/useApi";
import { useConfig } from "../hooks/useConfig";
import { usePageTitle } from "../hooks/usePageTitle";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { addedMessage } from "../lib/messages";
import type { Nutrition, Recipe, SubstituteResult } from "../types";

export function RecipeDetail() {
  const id = Number(useParams().id);
  const recipe = useApi(`recipe:${id}`, async () => (await getRecipe(id)).recipe);
  usePageTitle(recipe.data?.title ?? "Recipe");

  if (recipe.status === "loading") return <LoadingState label="Loading recipe…" />;
  if (!recipe.data) {
    return (
      <div className="error-page">
        <ErrorState message={recipe.error ?? "Couldn't load that recipe."} onRetry={() => void recipe.reload()} />
        <Link className="btn btn-primary" to="/">Back to recipes</Link>
      </div>
    );
  }
  return <RecipeView key={recipe.data.id} recipe={recipe.data} />;
}

function RecipeView({ recipe }: { recipe: Recipe }) {
  const { ai_enabled: aiEnabled } = useConfig();
  const toast = useToast();
  const shopping = useShoppingList();
  const navigate = useNavigate();
  const [multiplier, setMultiplier] = useState(1);
  const [lines, setLines] = useState(recipe.lines);
  const [swaps, setSwaps] = useState<Record<number, SubstituteResult | "loading">>({});
  const [nutrition, setNutrition] = useState<Nutrition | null>(recipe.nutrition);
  const [dietTags, setDietTags] = useState(recipe.diet_tags);
  const [nutritionNote, setNutritionNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"add" | "nutrition" | null>(null);
  const latestScale = useRef(0);

  async function changeServings(next: number) {
    setMultiplier(next);
    setSwaps({});
    const requestId = ++latestScale.current;
    try {
      const scaled = next === 1 ? recipe.lines : (await getScaled(recipe.id, next)).lines;
      if (requestId === latestScale.current) setLines(scaled);
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    }
  }

  async function toggleSwap(index: number, line: string) {
    if (swaps[index]) {
      setSwaps((current) => withoutKey(current, index));
      return;
    }
    setSwaps((current) => ({ ...current, [index]: "loading" }));
    try {
      const result = await suggestSubstitutes(line, recipe.id);
      setSwaps((current) => ({ ...current, [index]: result }));
    } catch (err) {
      setSwaps((current) => withoutKey(current, index));
      toast.show(errorMessage(err), { error: true });
    }
  }

  async function addToList() {
    setBusy("add");
    try {
      toast.show(addedMessage(await addRecipeToList(recipe.id, multiplier)));
      await shopping.reload();
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    } finally {
      setBusy(null);
    }
  }

  async function estimate() {
    setBusy("nutrition");
    try {
      const result = await estimateNutrition(recipe.id);
      setDietTags(result.diet_tags);
      if (result.nutrition) setNutrition(result.nutrition);
      setNutritionNote(result.message);
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    try {
      await deleteRecipe(recipe.id);
      toast.show(`Deleted “${recipe.title}”.`);
      navigate("/");
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    }
  }

  const category = recipe.category.toLowerCase();
  return (
    <article className={`recipe-page cat-${category}`}>
      <header className="recipe-hero">
        <Link className="link-quiet" to="/">← All recipes</Link>
        <div className="card-top">
          <span className={`tag tag-${category}`}>{recipe.category}</span>
          <span className="meta">
            <Icon name="clock" /> {recipe.prep_time} min prep
          </span>
        </div>
        <h1>{recipe.title}</h1>
        <DietTags tags={dietTags} />
      </header>

      <div className="recipe-layout">
        <section className="panel" aria-labelledby="ingredients-heading">
          <div className="panel-head">
            <h2 id="ingredients-heading">
              Ingredients {multiplier !== 1 && <span className="scale-badge">×{multiplier}</span>}
            </h2>
            <ServingsSelect value={multiplier} onChange={(m) => void changeServings(m)} recipeTitle={recipe.title} />
          </div>
          <ul className="lines lines-detail" aria-label={`Ingredients for ${recipe.title}`}>
            {lines.map((line, index) => {
              const swap = swaps[index];
              return (
                <li key={`${index}-${line}`}>
                  <span className="line-row">
                    <span>{line}</span>
                    <button className="btn-swap" type="button" aria-expanded={Boolean(swap)}
                      aria-label={`Suggest substitutes for ${line}`} onClick={() => void toggleSwap(index, line)}>
                      <Icon name="swap" />
                      <span>Swap</span>
                    </button>
                  </span>
                  {swap === "loading" && <div className="swap-box" role="status">Finding swaps…</div>}
                  {swap && swap !== "loading" && (
                    <div className="swap-box">
                      <span className="source-label">{swap.source === "ai" ? "Suggested by Gemini" : "Built-in suggestions"}</span>
                      {swap.substitutes.length > 0 && (
                        <ul>
                          {swap.substitutes.map((s) => (
                            <li key={s.swap}>
                              <strong>{s.swap}</strong>
                              {s.note && ` – ${s.note}`}
                            </li>
                          ))}
                        </ul>
                      )}
                      {swap.message && <p className="hint">{swap.message}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <button className="btn btn-primary btn-block" type="button" onClick={() => void addToList()} disabled={busy === "add"}>
            <Icon name="cart" />
            <span>{busy === "add" ? "Adding…" : "Add to shopping list"}</span>
          </button>
        </section>

        <aside className="panel panel-nutrition" aria-labelledby="nutrition-heading">
          <h2 id="nutrition-heading">
            Nutrition <span className="estimate-label">estimate</span>
          </h2>
          {nutrition ? (
            <>
              <dl className="nutrition">
                <NutritionCell label="Calories" value={nutrition.calories} unit="kcal" />
                <NutritionCell label="Protein" value={nutrition.protein_g} unit="g" />
                <NutritionCell label="Carbs" value={nutrition.carbs_g} unit="g" />
                <NutritionCell label="Fat" value={nutrition.fat_g} unit="g" />
              </dl>
              <p className="hint">
                Per serving{nutrition.servings ? `, about ${nutrition.servings} servings` : ""}. Estimated by Gemini.
              </p>
            </>
          ) : (
            <p className="hint">No nutrition estimate yet. Diet tags above come from an ingredient keyword check.</p>
          )}
          {nutritionNote && <p className="hint" role="status">{nutritionNote}</p>}
          <button className="btn btn-ghost btn-block" type="button" onClick={() => void estimate()} disabled={busy === "nutrition"}>
            <Icon name="sparkle" />
            <span>{busy === "nutrition" ? "Estimating…" : nutrition ? "Re-estimate" : "Estimate nutrition"}</span>
          </button>
          {!aiEnabled && !nutritionNote && <p className="hint">Gemini is off, so this shows keyword-based diet tags only.</p>}
        </aside>
      </div>

      <div className="danger-zone">
        <ConfirmButton className="btn btn-danger" confirmLabel="Tap again to delete" onConfirm={() => void remove()}>
          <Icon name="trash" />
          <span>Delete recipe</span>
        </ConfirmButton>
      </div>
    </article>
  );
}

function withoutKey<T>(record: Record<number, T>, key: number): Record<number, T> {
  return Object.fromEntries(Object.entries(record).filter(([other]) => Number(other) !== key));
}

function NutritionCell({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null ? "—" : `${value} ${unit}`}</dd>
    </div>
  );
}
