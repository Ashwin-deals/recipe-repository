import { ShoppingList } from "../components/ShoppingList";
import { usePageTitle } from "../hooks/usePageTitle";

export function Shopping() {
  usePageTitle("Shopping list");
  return (
    <div className="list-page">
      <ShoppingList variant="full" />
    </div>
  );
}
