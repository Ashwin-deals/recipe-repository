import { Link } from "react-router-dom";
import type { PlanEntry } from "../types";

interface PlannerGridProps {
  days: string[];
  plan: Record<string, PlanEntry[]>;
  onRemove: (entry: PlanEntry) => void;
}

export function PlannerGrid({ days, plan, onRemove }: PlannerGridProps) {
  return (
    <ol className="week">
      {days.map((day) => {
        const meals = plan[day] ?? [];
        return (
          <li className="day" id={day.toLowerCase()} key={day}>
            <h2 className="day-name">{day}</h2>
            {meals.length ? (
              <ul className="day-meals">
                {meals.map((entry) => (
                  <li className={`meal cat-${entry.category.toLowerCase()}`} key={entry.id}>
                    <Link to={`/recipes/${entry.recipe_id}`}>{entry.title}</Link>
                    <span className="meal-meta">
                      {entry.multiplier}x · {entry.prep_time} min
                    </span>
                    <button className="btn-icon" type="button" aria-label={`Remove ${entry.title} from ${day}`}
                      onClick={() => onRemove(entry)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="day-empty">Nothing planned</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
