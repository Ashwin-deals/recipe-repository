import { useState, type FormEvent } from "react";
import { importRecipe } from "../api/endpoints";
import { useConfig } from "../hooks/useConfig";
import { errorMessage } from "../lib/errors";
import type { RecipeDraft } from "../types";
import { Icon } from "./Icon";

type Mode = "text" | "image";

/** Snap-a-recipe: photo or pasted text pre-fills the recipe form. Never saves anything. */
export function ImportPanel({ onPrefill }: { onPrefill: (draft: RecipeDraft) => void }) {
  const { ai_enabled: aiEnabled, max_image_bytes: maxBytes } = useConfig();
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "image") {
      if (!file) return setStatus({ message: "Choose a photo first.", error: true });
      if (file.size > maxBytes) return setStatus({ message: "That photo is over 5 MB. Try a smaller one.", error: true });
    } else if (!text.trim()) {
      return setStatus({ message: "Paste some recipe text first.", error: true });
    }
    setBusy(true);
    setStatus({ message: mode === "image" ? "Reading your photo…" : "Reading your recipe…", error: false });
    try {
      const result = await importRecipe(mode === "image" && file ? { image: file } : { text });
      onPrefill(result.recipe);
      setStatus({ message: result.message, error: false });
    } catch (err) {
      setStatus({ message: errorMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel import-panel" aria-labelledby="import-heading">
      <h2 id="import-heading">
        <Icon name="camera" /> Snap a recipe
      </h2>
      <p className="hint">
        Paste a recipe in any language or upload a photo or screenshot. We'll fill the form below for you to review.
        Nothing is saved until you press <strong>Save recipe</strong>.
        {!aiEnabled && " Gemini is off, so pasted text uses the basic parser and photos aren't available."}
      </p>
      <form className="import-form" onSubmit={(event) => void submit(event)}>
        <div className="segmented" role="group" aria-label="Import source">
          {(["text", "image"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? "is-active" : ""}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {option === "text" ? "Paste text" : "Photo"}
            </button>
          ))}
        </div>
        {mode === "text" ? (
          <div className="field">
            <label className="visually-hidden" htmlFor="import-text">
              Recipe text
            </label>
            <textarea
              id="import-text"
              rows={5}
              maxLength={8000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"Banana pancakes\nPrep 15 min\nIngredients:\n2 ripe bananas\n1 cup flour"}
            />
          </div>
        ) : (
          <label className="file-drop">
            <Icon name="camera" />
            <span>{file ? file.name : "Choose a JPEG, PNG or WebP (max 5 MB)"}</span>
            <input
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        )}
        <button className="btn btn-ghost" type="submit" disabled={busy}>
          <Icon name="sparkle" />
          <span>{busy ? "Reading…" : "Fill the form"}</span>
        </button>
        {status && (
          <p className={status.error ? "import-status is-error" : "import-status"} role="status">
            {status.message}
          </p>
        )}
      </form>
    </section>
  );
}
