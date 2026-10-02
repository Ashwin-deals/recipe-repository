import type { ViewItem } from "../lib/listView";

export function ListItem({ item, onToggle }: { item: ViewItem; onToggle: (item: ViewItem) => void }) {
  const classes = ["item", item.checked && "is-checked", item.pending && "is-pending"].filter(Boolean).join(" ");
  return (
    <li>
      <button type="button" className={classes} aria-pressed={item.checked} onClick={() => onToggle(item)}>
        <span className="box" aria-hidden="true" />
        <span className="item-text">
          <span className="item-label">{item.label}</span>
          {item.sources.length > 0 && <span className="item-sources">{item.sources.join(" · ")}</span>}
        </span>
      </button>
    </li>
  );
}
