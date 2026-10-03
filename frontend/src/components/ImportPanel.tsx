import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { importRecipe } from "../api/endpoints";
import { useConfig } from "../hooks/useConfig";
import { errorMessage } from "../lib/errors";
import { checkImage } from "../lib/imageCheck";
import type { ImportResult } from "../types";
import { Icon } from "./Icon";

const MAX_TEXT = 8000;

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

/**
 * Snap-a-recipe: a photo/screenshot and/or pasted text is sent to /api/import and the result
 * handed to the form for review. Nothing is saved here.
 */
export function ImportPanel({ onImported }: { onImported: (result: ImportResult, fromPhoto: boolean) => void }) {
  const { ai_enabled: aiEnabled, max_image_bytes: maxBytes } = useConfig();
  const id = useId();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreview(null);
    };
  }, [file]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = ""; // allow picking the same file again after removing it
    if (!chosen) return;
    const problem = checkImage(chosen, maxBytes);
    if (problem) {
      setStatus({ kind: "error", message: problem });
      return;
    }
    setFile(chosen);
    setStatus({ kind: "idle" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (status.kind === "loading") return;
    if (!file && !text.trim()) {
      setStatus({ kind: "error", message: "Choose a photo or paste some recipe text first." });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const result = await importRecipe({ image: file, text });
      setStatus({ kind: "success", message: result.message });
      onImported(result, file !== null);
    } catch (err) {
      setStatus({ kind: "error", message: errorMessage(err) });
    }
  }

  const loading = status.kind === "loading";
  return (
    <section className="panel import-panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        <Icon name="camera" /> Snap a recipe
      </h2>
      <p className="hint" id={`${id}-hint`}>
        Upload a photo or screenshot, or paste a recipe in any language. We'll fill in the form below for you to
        review; nothing is saved until you press <strong>Save recipe</strong>.
        {!aiEnabled && " The AI service is off, so pasted text uses a basic parser and photos can't be read."}
      </p>
      <form className="import-form" onSubmit={(event) => void submit(event)} aria-describedby={`${id}-hint`}>
        <div className="file-buttons">
          <label className="btn btn-ghost file-button">
            <Icon name="camera" />
            <span>Take photo</span>
            <input className="visually-hidden" type="file" accept="image/*" capture="environment"
              onChange={chooseFile} disabled={loading} />
          </label>
          <label className="btn btn-ghost file-button">
            <Icon name="plus" />
            <span>Choose image</span>
            <input className="visually-hidden" type="file" accept="image/*" onChange={chooseFile} disabled={loading} />
          </label>
        </div>

        {file && preview && (
          <figure className="import-preview">
            <img src={preview} alt="Selected recipe photo" />
            <figcaption>
              <span>{file.name}</span>
              <button type="button" className="btn-text" onClick={() => setFile(null)} disabled={loading}>
                Remove
              </button>
            </figcaption>
          </figure>
        )}

        <div className="field">
          <label htmlFor={`${id}-text`}>Or paste recipe text</label>
          <textarea id={`${id}-text`} rows={5} maxLength={MAX_TEXT} value={text} disabled={loading}
            onChange={(event) => setText(event.target.value)}
            placeholder={"Banana pancakes\nPrep 15 min\nIngredients:\n2 ripe bananas\n1 cup flour"} />
        </div>

        <button className="btn btn-primary import-submit" type="submit" disabled={loading} aria-busy={loading}>
          {loading ? <span className="spinner spinner-light" aria-hidden="true" /> : <Icon name="sparkle" />}
          <span>{loading ? "Importing…" : "Import"}</span>
        </button>

        <div aria-live="polite" className="import-live">
          {status.kind === "loading" && <p className="import-status">Reading your recipe…</p>}
          {status.kind === "success" && <p className="import-status">{status.message}</p>}
        </div>
        {status.kind === "error" && (
          <p className="import-status is-error" role="alert">
            {status.message}
          </p>
        )}
      </form>
    </section>
  );
}
