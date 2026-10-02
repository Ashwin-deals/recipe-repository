import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { createRecipe, type RecipeInput } from "../api/endpoints";
import { useConfig } from "../hooks/useConfig";
import { errorMessage } from "../lib/errors";
import type { Recipe, RecipeDraft } from "../types";
import { ImportPanel } from "./ImportPanel";

interface RecipeFormProps {
  onSaved: (recipe: Recipe) => void;
  onCancel: () => void;
}

const EMPTY: RecipeInput = { title: "", prep_time: "", category: "", ingredients: "" };

export function RecipeForm({ onSaved, onCancel }: RecipeFormProps) {
  const { categories } = useConfig();
  const [values, setValues] = useState<RecipeInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filledAt, setFilledAt] = useState(0);

  const update = (field: keyof RecipeInput, value: string) => setValues((current) => ({ ...current, [field]: value }));

  function prefill(draft: RecipeDraft) {
    setValues((current) => ({
      title: draft.title || current.title,
      prep_time: draft.prep_time === null ? current.prep_time : String(draft.prep_time),
      category: draft.category || current.category,
      ingredients: draft.ingredients.length ? draft.ingredients.join("\n") : current.ingredients,
    }));
    setFilledAt(Date.now());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const { recipe } = await createRecipe(values);
      setValues(EMPTY);
      setErrors({});
      onSaved(recipe);
    } catch (err) {
      setErrors(err instanceof ApiError ? err.fields : {});
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const fieldProps = (name: keyof RecipeInput) => ({
    id: `recipe-${name}`,
    name,
    value: values[name],
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `recipe-${name}-error` : undefined,
    // Re-keying on prefill replays the highlight animation on filled fields.
    className: filledAt ? "is-filled" : undefined,
  });

  const fieldError = (name: keyof RecipeInput) =>
    errors[name] ? (
      <p className="field-error" id={`recipe-${name}-error`}>
        {errors[name]}
      </p>
    ) : null;

  return (
    <div className="form-stack">
      <ImportPanel onPrefill={prefill} />
      <form className="panel recipe-form" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="new-recipe-heading">
        <h2 id="new-recipe-heading">New recipe</h2>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className={errors.title ? "field has-error" : "field"}>
          <label htmlFor="recipe-title">Title</label>
          <input key={`title-${filledAt}`} type="text" maxLength={120} placeholder="Grandma's apple crumble"
            {...fieldProps("title")} onChange={(event) => update("title", event.target.value)} />
          {fieldError("title")}
        </div>
        <div className="field-row">
          <div className={errors.prep_time ? "field has-error" : "field"}>
            <label htmlFor="recipe-prep_time">Prep time (minutes)</label>
            <input key={`prep-${filledAt}`} type="number" inputMode="numeric" min={0} max={1440} placeholder="20"
              {...fieldProps("prep_time")} onChange={(event) => update("prep_time", event.target.value)} />
            {fieldError("prep_time")}
          </div>
          <div className={errors.category ? "field has-error" : "field"}>
            <label htmlFor="recipe-category">Category</label>
            <select key={`category-${filledAt}`} {...fieldProps("category")} onChange={(event) => update("category", event.target.value)}>
              <option value="">Choose…</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            {fieldError("category")}
          </div>
        </div>
        <div className={errors.ingredients ? "field has-error" : "field"}>
          <label htmlFor="recipe-ingredients">
            Ingredients <span className="hint-inline">one per line</span>
          </label>
          <textarea key={`ingredients-${filledAt}`} rows={10} placeholder={"2 cups flour\n1 1/2 cups milk\n2 eggs\nsalt to taste"}
            {...fieldProps("ingredients")} onChange={(event) => update("ingredients", event.target.value)} />
          {fieldError("ingredients")}
        </div>
        <div className="form-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save recipe"}
          </button>
        </div>
      </form>
    </div>
  );
}
