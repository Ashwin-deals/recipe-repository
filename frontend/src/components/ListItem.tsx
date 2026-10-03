import type { CSSProperties } from "react";
import type { ViewItem } from "../lib/listView";

/** One receipt line: name, dotted leader, quantity. The whole row is the tick button. */
export function ListItem({ item, index, onToggle }: { item: ViewItem; index: number; onToggle: (item: ViewItem) => void }) {
  const classes = ["item", item.checked && "is-checked", item.pending && "is-pending"].filter(Boolean).join(" ");
  return (
    <li className="receipt-row" style={{ "--i": Math.min(index, 14) } as CSSProperties}>
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
    </li>
  );
}
