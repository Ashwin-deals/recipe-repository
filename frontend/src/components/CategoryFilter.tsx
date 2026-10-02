import { useConfig } from "../hooks/useConfig";
import type { Category } from "../types";

interface CategoryFilterProps {
  value: Category | null;
  onChange: (category: Category | null) => void;
}

export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  const { categories } = useConfig();
  const options: Array<Category | null> = [null, ...categories];
  return (
    <div className="filters" role="group" aria-label="Filter recipes by category">
      {options.map((category) => (
        <button
          key={category ?? "all"}
          type="button"
          className={`chip${category ? ` chip-${category.toLowerCase()}` : ""}${value === category ? " is-active" : ""}`}
          aria-pressed={value === category}
          onClick={() => onChange(category)}
        >
          {category ?? "All"}
        </button>
      ))}
    </div>
  );
}
