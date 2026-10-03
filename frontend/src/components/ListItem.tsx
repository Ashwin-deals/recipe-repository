import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { useShoppingList } from "../hooks/useShoppingList";
import { errorMessage } from "../lib/errors";
import type { ViewItem } from "../lib/listView";
import { Icon } from "./Icon";

/** One receipt line: name, dotted leader, quantity. The row is the tick button; the pencil edits the amount. */
export function ListItem({ item, index, onToggle }: { item: ViewItem; index: number; onToggle: (item: ViewItem) => void }) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const classes = ["item", item.checked && "is-checked", item.pending && "is-pending"].filter(Boolean).join(" ");

  const close = () => {
    setEditing(false);
    editButton.current?.focus();
  };

  return (
    <li className="receipt-row" data-item-id={item.id} style={{ "--i": Math.min(index, 14) } as CSSProperties}>
      <div className="item-row">
        <button type="button" className={classes} aria-pressed={item.checked} aria-label={item.label} onClick={() => onToggle(item)}>
          <span className="box" aria-hidden="true" />
          <span className="item-main">
            <span className="item-line">
              <span className="item-name">{item.name}</span>
              {item.amount && (
                <>
                  <span className="item-leader" aria-hidden="true" />
                  <span className="item-qty">{item.amount}</span>
                </>
              )}
            </span>
            {item.sources.length > 0 && <span className="item-sources">{item.sources.join(" · ")}</span>}
          </span>
        </button>
        <button
          type="button"
          ref={editButton}
          className="item-edit"
          aria-label={`Change amount of ${item.name}`}
          aria-expanded={editing}
          onClick={() => setEditing((open) => !open)}
        >
          <Icon name="edit" />
        </button>
      </div>
      {editing && <AmountEditor item={item} onDone={close} />}
    </li>
  );
}

function AmountEditor({ item, onDone }: { item: ViewItem; onDone: () => void }) {
  const list = useShoppingList();
  const [amount, setAmount] = useState(item.amount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    input.current?.select();
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (amount.trim() === item.amount) return onDone();
    void run(() => list.setAmount(item.id, amount));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onDone();
    }
  };

  return (
    <form className="amount-editor" onSubmit={save} onKeyDown={onKeyDown} aria-busy={busy}>
      <label className="visually-hidden" htmlFor={inputId}>
        Amount of {item.name}
      </label>
      <input
        ref={input}
        id={inputId}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="e.g. 1, 2 cups, 1/2 tsp"
        autoComplete="off"
        enterKeyHint="done"
        maxLength={200}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={busy}
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => list.remove(item.id))}>
        Remove
      </button>
      {error && (
        <p className="amount-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
