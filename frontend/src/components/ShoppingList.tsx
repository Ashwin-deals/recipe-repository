import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { ListItem } from "./ListItem";
import { ErrorState, LoadingState } from "./States";

export function ShoppingList({ variant }: { variant: "panel" | "full" }) {
  const list = useShoppingList();
  const toast = useToast();
  const inputId = useId();
  const [line, setLine] = useState("");
  const [adding, setAdding] = useState(false);
  const { counts } = list;

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!line.trim()) return;
    setAdding(true);
    try {
      const result = await list.addItem(line);
      setLine("");
      toast.show(result.merged ? "Merged with an item already on the list." : "Added to the list.");
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    } finally {
      setAdding(false);
    }
  }

  async function clear(scope: "all" | "checked") {
    try {
      const removed = await list.clear(scope);
      toast.show(removed ? `Removed ${removed} item${removed === 1 ? "" : "s"}.` : "Nothing to clear.");
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    }
  }

  return (
    <section className="notepad" aria-labelledby={`${inputId}-heading`}>
      <div className="notepad-head">
        <div>
          <p className="eyebrow">Shopping list</p>
          {variant === "full" ? (
            <h1 className="notepad-title" id={`${inputId}-heading`}>Today's shop</h1>
          ) : (
            <h2 className="notepad-title" id={`${inputId}-heading`}>Your list</h2>
          )}
        </div>
        {variant === "panel" && (
          <Link className="link-quiet" to="/shopping">
            Open full list
          </Link>
        )}
      </div>

      <form className="add-item" onSubmit={(event) => void addItem(event)} autoComplete="off">
        <label className="visually-hidden" htmlFor={inputId}>
          Add an item
        </label>
        <input id={inputId} type="text" maxLength={200} placeholder="Add an item, e.g. 2 lemons" value={line}
          onChange={(event) => setLine(event.target.value)} />
        <button className="btn btn-ghost" type="submit" aria-label="Add item" disabled={adding}>
          <Icon name="plus" />
        </button>
      </form>

      {list.status === "loading" && <LoadingState label="Loading your list…" />}
      {list.status === "error" && <ErrorState message={list.error ?? "Couldn't load the list."} onRetry={() => void list.reload()} />}
      {list.status === "ready" && (
        <>
          {list.error && <p className="hint" role="status">Showing the last saved list. {list.error}</p>}
          <p className="list-count">
            {counts.total ? (
              <>
                <strong>{counts.open}</strong> to buy
                {counts.checked > 0 && (
                  <>
                    {" · "}
                    <strong>{counts.checked}</strong> in the cart
                  </>
                )}
              </>
            ) : (
              "Nothing on the list yet."
            )}
          </p>
          {list.groups.length ? (
            list.groups.map((group) => (
              <section className="aisle" key={group.aisle} aria-label={group.aisle}>
                <h3 className="aisle-name">{group.aisle}</h3>
                <ul className="items">
                  {group.items.map((item) => (
                    <ListItem key={item.id} item={item} onToggle={list.toggle} />
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <div className="list-empty">
              <Icon name="cart" />
              <p>
                Pick a recipe and press <strong>Add to list</strong>. Matching ingredients merge automatically.
              </p>
            </div>
          )}
        </>
      )}

      <div className="notepad-actions">
        <ConfirmButton className="btn btn-quiet" confirmLabel="Tap again" disabled={!counts.checked}
          onConfirm={() => void clear("checked")}>
          Clear checked
        </ConfirmButton>
        <ConfirmButton className="btn btn-danger" confirmLabel="Tap again to clear" disabled={!counts.total}
          onConfirm={() => void clear("all")}>
          <Icon name="trash" />
          <span>Clear list</span>
        </ConfirmButton>
      </div>
      {list.pendingCount > 0 && (
        <p className="sync-note" role="status">
          {list.pendingCount} change{list.pendingCount === 1 ? "" : "s"} waiting to sync
        </p>
      )}
    </section>
  );
}
