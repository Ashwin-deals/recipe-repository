import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { addToPlan, buildPlanList, clearPlan, getPlanner, removeFromPlan } from "../api/endpoints";
import { ConfirmButton } from "../components/ConfirmButton";
import { Icon } from "../components/Icon";
import { PlannerGrid } from "../components/PlannerGrid";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useApi } from "../hooks/useApi";
import { useConfig } from "../hooks/useConfig";
import { usePageTitle } from "../hooks/usePageTitle";
import { useRecipes } from "../hooks/useRecipes";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import type { PlanEntry } from "../types";

export function Planner() {
  usePageTitle("Meal planner");
  const { days, multipliers } = useConfig();
  const toast = useToast();
  const shopping = useShoppingList();
  const navigate = useNavigate();
  const planner = useApi("planner", getPlanner);
  const recipes = useRecipes(null);
  const [day, setDay] = useState("Monday");
  const [recipeId, setRecipeId] = useState("");
  const [multiplier, setMultiplier] = useState(1);
  const [busy, setBusy] = useState(false);

  const selectedRecipe = recipeId || String(recipes.data?.[0]?.id ?? "");
  const plan = planner.data?.plan ?? {};
  const plannedMeals = Object.values(plan).reduce((sum, meals) => sum + meals.length, 0);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    } finally {
      setBusy(false);
    }
  }

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      planner.setData(await addToPlan(day, Number(selectedRecipe), multiplier));
    });
  };

  const remove = (entry: PlanEntry) =>
    void run(async () => {
      planner.setData(await removeFromPlan(entry.id));
    });

  const clearWeek = () =>
    void run(async () => {
      planner.setData(await clearPlan());
      toast.show("Cleared the week.");
    });

  const build = () =>
    void run(async () => {
      const result = await buildPlanList();
      await shopping.reload();
      toast.show(`Added ${result.meals} planned meals: ${result.added} new items, ${result.merged} merged.`);
      navigate("/shopping");
    });

  return (
    <div className="planner-page">
      <div className="pane-head">
        <div>
          <p className="eyebrow">Weekly planner</p>
          <h1>Plan the week, shop once</h1>
        </div>
        <button className="btn btn-primary" type="button" onClick={build} disabled={busy || plannedMeals === 0}>
          <Icon name="cart" />
          <span>Build shopping list</span>
        </button>
      </div>

      {recipes.data && recipes.data.length > 0 && (
        <form className="panel plan-form" onSubmit={add}>
          <div className="field">
            <label htmlFor="plan-day">Day</label>
            <select id="plan-day" value={day} onChange={(event) => setDay(event.target.value)}>
              {days.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="field field-grow">
            <label htmlFor="plan-recipe">Recipe</label>
            <select id="plan-recipe" value={selectedRecipe} onChange={(event) => setRecipeId(event.target.value)}>
              {recipes.data.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.title} ({recipe.category})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="plan-multiplier">Servings</label>
            <select id="plan-multiplier" value={multiplier} onChange={(event) => setMultiplier(Number(event.target.value))}>
              {multipliers.map((m) => (
                <option key={m} value={m}>
                  {m}x
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-ghost" type="submit" disabled={busy}>
            <Icon name="plus" />
            <span>Add to plan</span>
          </button>
        </form>
      )}
      {recipes.data?.length === 0 && (
        <EmptyState>
          <p>Add some recipes first, then plan your week here.</p>
        </EmptyState>
      )}

      {planner.status === "loading" && <LoadingState label="Loading your week…" />}
      {planner.status === "error" && (
        <ErrorState message={planner.error ?? "Couldn't load the planner."} onRetry={() => void planner.reload()} />
      )}
      {planner.data && (
        <>
          <PlannerGrid days={planner.data.days} plan={plan} onRemove={remove} />
          <div className="planner-clear">
            <ConfirmButton className="btn btn-quiet" confirmLabel="Tap again to clear the week" disabled={busy || plannedMeals === 0}
              onConfirm={clearWeek}>
              Clear the week
            </ConfirmButton>
          </div>
        </>
      )}
    </div>
  );
}
