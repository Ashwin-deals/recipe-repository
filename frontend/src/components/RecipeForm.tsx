import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { createRecipe, type RecipeInput } from "../api/endpoints";
import { useConfig } from "../hooks/useConfig";
import { errorMessage } from "../lib/errors";
import type { ImportResult, Recipe, RecipeDraft } from "../types";
import { ImportPanel } from "./ImportPanel";

interface RecipeFormProps {
  onSaved: (recipe: Recipe) => void;
  onCancel: () => void;
}

const EMPTY: RecipeInput = { title: "", prep_time: "", category: "", ingredients: "" };
const FIELD_LABELS: Record<keyof RecipeInput, string> = {
  title: "Title",
  prep_time: "Prep time",
  category: "Category",
  ingredients: "Ingredients",
};

/** The imported values as form text; empty strings where the import found nothing. */
function draftToInput(draft: RecipeDraft): RecipeInput {
  // A missing or zero prep time means "not found": leave the field empty rather than guess.
  const prep = draft.prep_time;
  return {
    title: draft.title,
    prep_time: prep === null || prep === undefined || prep <= 0 ? "" : String(prep),
    category: draft.category,
    ingredients: draft.ingredients.join("\n"),
  };
}

/** Fields the user has typed in that the import would change. */
function conflicts(current: RecipeInput, incoming: RecipeInput): Array<keyof RecipeInput> {
  return (Object.keys(FIELD_LABELS) as Array<keyof RecipeInput>).filter(
    (field) => current[field].trim() && incoming[field] && current[field].trim() !== incoming[field].trim(),
  );
}

export function RecipeForm({ onSaved, onCancel }: RecipeFormProps) {
  const { categories } = useConfig();
  const [values, setValues] = useState<RecipeInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filledAt, setFilledAt] = useState(0);
  const [pending, setPending] = useState<{
    incoming: RecipeInput;
    fields: Array<keyof RecipeInput>;
    fromPhoto: boolean;
  } | null>(null);
  const [prepHint, setPrepHint] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const prepRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);

  const update = (field: keyof RecipeInput, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === "prep_time") setPrepHint(null);
  };

  // After an import is applied, move focus to the form so the user can review it.
  useEffect(() => {
    if (filledAt) titleRef.current?.focus();
  }, [filledAt]);

  useEffect(() => {
    if (pending) replaceRef.current?.focus();
  }, [pending]);

  function apply(incoming: RecipeInput, onlyEmpty: boolean, fromPhoto: boolean) {
    const next = { ...values };
    for (const field of Object.keys(FIELD_LABELS) as Array<keyof RecipeInput>) {
      if (incoming[field] && (!onlyEmpty || !values[field].trim())) next[field] = incoming[field];
    }
    setValues(next);
    setPrepHint(next.prep_time.trim() ? null : `No prep time found in the ${fromPhoto ? "photo" : "text"}. Please enter it.`);
    setErrors({});
    setFormError(null);
    setPending(null);
    setFilledAt(Date.now());
  }

  function handleImported(result: ImportResult, fromPhoto: boolean) {
    const incoming = draftToInput(result.recipe);
    const fields = conflicts(values, incoming);
    if (fields.length) setPending({ incoming, fields, fromPhoto });
    else apply(incoming, false, fromPhoto);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Prep time is required; say so plainly before sending (the server validates it too).
    if (!values.prep_time.trim()) {
      setErrors((current) => ({ ...current, prep_time: "Enter the prep time in minutes (0 to 1440)." }));
      setFormError("Please fix the highlighted fields.");
      setPrepHint(null);
      prepRef.current?.focus();
      return;
    }
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
    // Re-keying after an import remounts the field, which replays the highlight animation.
    key: `${name}-${filledAt}`,
    id: `recipe-${name}`,
    name,
    value: values[name],
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name]
      ? `recipe-${name}-error`
      : name === "prep_time" && prepHint ? "recipe-prep_time-hint" : undefined,
    className: filledAt ? "is-filled" : undefined,
  });

  const fieldError = (name: keyof RecipeInput) =>
    errors[name] ? (
      <p className="field-error" id={`recipe-${name}-error`}>
        {errors[name]}
      </p>
    ) : null;

  const { key: titleKey, ...titleProps } = fieldProps("title");
  const { key: prepKey, ...prepProps } = fieldProps("prep_time");
  const { key: categoryKey, ...categoryProps } = fieldProps("category");
  const { key: ingredientsKey, ...ingredientsProps } = fieldProps("ingredients");

  return (
    <div className="form-stack">
      <ImportPanel onImported={handleImported} />
      <form className="panel recipe-form" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="new-recipe-heading">
        <h2 id="new-recipe-heading">New recipe</h2>

        {pending && (
          <div className="confirm-bar" role="group" aria-labelledby="import-conflict">
            <p id="import-conflict">
              The import would replace what you've already typed in{" "}
              <strong>{pending.fields.map((field) => FIELD_LABELS[field]).join(", ")}</strong>.
            </p>
            <div className="confirm-actions">
              <button ref={replaceRef} type="button" className="btn btn-primary"
                onClick={() => apply(pending.incoming, false, pending.fromPhoto)}>
                Replace with import
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => apply(pending.incoming, true, pending.fromPhoto)}>
                Keep mine, fill empty fields
              </button>
            </div>
          </div>
        )}

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className={errors.title ? "field has-error" : "field"}>
          <label htmlFor="recipe-title">Title</label>
          <input key={titleKey} ref={titleRef} type="text" maxLength={120} placeholder="Grandma's apple crumble"
            {...titleProps} onChange={(event) => update("title", event.target.value)} />
          {fieldError("title")}
        </div>
        <div className="field-row">
          <div className={errors.prep_time ? "field has-error" : "field"}>
            <label htmlFor="recipe-prep_time">Prep time (minutes)</label>
            <input key={prepKey} ref={prepRef} type="number" inputMode="numeric" min={0} max={1440} placeholder="e.g. 20"
              {...prepProps} onChange={(event) => update("prep_time", event.target.value)} />
            {fieldError("prep_time")}
            {prepHint && !errors.prep_time && (
              <p className="field-hint" id="recipe-prep_time-hint" role="status">
                {prepHint}
              </p>
            )}
          </div>
          <div className={errors.category ? "field has-error" : "field"}>
            <label htmlFor="recipe-category">Category</label>
            <select key={categoryKey} {...categoryProps} onChange={(event) => update("category", event.target.value)}>
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
          <textarea key={ingredientsKey} rows={10} placeholder={"2 cups flour\n1 1/2 cups milk\n2 eggs\nsalt to taste"}
            {...ingredientsProps} onChange={(event) => update("ingredients", event.target.value)} />
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
