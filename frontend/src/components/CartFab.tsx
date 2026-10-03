import { Link, useLocation } from "react-router-dom";
import { useShoppingList } from "../hooks/useShoppingList";
import { Icon } from "./Icon";

/** Floating cart button for phones, with a live count. Hidden on the list page and on desktop (CSS). */
export function CartFab() {
  const { counts } = useShoppingList();
  const { pathname } = useLocation();
  if (pathname === "/shopping") return null;
  return (
    <Link to="/shopping" className="cart-fab" data-cart-target="primary" aria-label={`Shopping list, ${counts.open} to buy`}>
      <Icon name="cart" />
      {counts.open > 0 && (
        <span className="fab-badge" key={counts.open} aria-hidden="true">
          {counts.open}
        </span>
      )}
    </Link>
  );
}
