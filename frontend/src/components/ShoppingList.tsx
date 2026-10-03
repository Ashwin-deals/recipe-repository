import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { Illustration } from "./Illustration";
import { ListItem } from "./ListItem";
import { ErrorState, LoadingState } from "./States";

const TODAY = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/** The shopping list, printed as a till receipt (the app's signature element). */
export function ShoppingList({ variant }: { variant: "panel" | "full" }) {
  const list = useShoppingList();
  const toast = useToast();
  const id = useId();
  const [line, setLine] = useState("");
  const [adding, setAdding] = useState(false);
  const { counts } = list;
  const Heading = variant === "full" ? "h1" : "h2";
  let row = 0;

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
    <section className={`receipt receipt-${variant}`} aria-labelledby={`${id}-heading`}>
      <div className="receipt-paper">
        <header className="receipt-head" data-cart-target="primary">
          <p className="receipt-store">CartChef Market</p>
          <Heading className="receipt-title" id={`${id}-heading`}>
            Shopping list
          </Heading>
          <p className="receipt-meta">
            <span>{TODAY.format(new Date())}</span>
            <span>
              No. <span className="num">{String(counts.total).padStart(3, "0")}</span>
            </span>
          </p>
          {variant === "panel" && (
            <Link className="receipt-link" to="/shopping">
              Open full list <Icon name="arrow" />
            </Link>
          )}
        </header>

        <form className="receipt-add" onSubmit={(event) => void addItem(event)} autoComplete="off">
          <label className="visually-hidden" htmlFor={id}>
            Add an item
          </label>
          <input id={id} type="text" maxLength={200} placeholder="Add an item, e.g. 2 lemons" value={line}
            onChange={(event) => setLine(event.target.value)} />
          <button className="btn btn-ink" type="submit" aria-label="Add item" disabled={adding}>
            <Icon name="plus" />
          </button>
        </form>

        {list.status === "loading" && <LoadingState label="Loading your list…" kind="list" />}
        {list.status === "error" && <ErrorState message={list.error ?? "Couldn't load the list."} onRetry={() => void list.reload()} />}
        {list.status === "ready" && (
          <>
            {list.error && <p className="receipt-note" role="status">Showing the last saved list. {list.error}</p>}
            <p className="list-count" aria-live="polite">
              {counts.total ? (
                <>
                  <strong className="num">{counts.open}</strong> to buy
                  {counts.checked > 0 && (
                    <>
                      {" · "}
                      <strong className="num">{counts.checked}</strong> in the cart
                    </>
                  )}
                </>
              ) : (
                "Nothing on the list yet."
              )}
            </p>
            {list.groups.length ? (
              list.groups.map((group) => (
                <section className="receipt-aisle" key={group.aisle} aria-label={group.aisle}>
                  <h3 className="aisle-name">{group.aisle}</h3>
                  <ul className="receipt-items">
                    {group.items.map((item) => (
                      <ListItem key={item.id} item={item} index={row++} onToggle={list.toggle} />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <div className="receipt-empty">
                <Illustration name="basket" />
                <p>
                  Open a recipe and press <strong>Add to list</strong>. Matching ingredients merge into one line.
                </p>
              </div>
            )}
          </>
        )}

        <footer className="receipt-foot">
          <dl className="receipt-total">
            <div>
              <dt>Items</dt>
              <dd className="num">{counts.total}</dd>
            </div>
            <div>
              <dt>In cart</dt>
              <dd className="num">{counts.checked}</dd>
            </div>
            <div className="receipt-total-main">
              <dt>Left</dt>
              <dd className="num">{counts.open}</dd>
            </div>
          </dl>
          <div className="receipt-actions">
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
          <div className="barcode" aria-hidden="true" />
          <p className="receipt-thanks" aria-hidden="true">Thank you for cooking with CartChef</p>
        </footer>
      </div>
    </section>
  );
}
