import { NavLink } from "react-router-dom";
import { useShoppingList } from "../hooks/useShoppingList";
import { GlobalSearch } from "./GlobalSearch";
import { Icon, type IconName } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

const LINKS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/", label: "Recipes", icon: "book" },
  { to: "/shopping", label: "List", icon: "list" },
  { to: "/planner", label: "Planner", icon: "calendar" },
  { to: "/insights", label: "Insights", icon: "chart" },
];

export function Nav() {
  const { counts } = useShoppingList();
  return (
    <header className="topbar">
      <NavLink className="brand" to="/" aria-label="CartChef home">
        <span className="brand-mark">
          <Icon name="hat" />
        </span>
        <span className="brand-name">
          Cart<span>Chef</span>
        </span>
      </NavLink>
      <GlobalSearch />
      <nav className="nav" aria-label="Main">
        {LINKS.map((link) => (
          <NavLink key={link.to} className="nav-link" to={link.to} end={link.to === "/"}
            data-cart-target={link.to === "/shopping" ? "secondary" : undefined}>
            <Icon name={link.icon} />
            <span className="nav-label">{link.label}</span>
            {link.to === "/shopping" && counts.open > 0 && (
              <span className="nav-badge" key={counts.open} aria-label={`${counts.open} items to buy`}>
                {counts.open}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <ThemeToggle />
    </header>
  );
}
