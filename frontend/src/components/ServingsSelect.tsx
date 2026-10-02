import { useId } from "react";
import { useConfig } from "../hooks/useConfig";

interface ServingsSelectProps {
  value: number;
  onChange: (multiplier: number) => void;
  recipeTitle: string;
}

export function ServingsSelect({ value, onChange, recipeTitle }: ServingsSelectProps) {
  const { multipliers } = useConfig();
  const id = useId();
  return (
    <div className="scaler">
      <label className="scaler-label" htmlFor={id}>
        Servings
      </label>
      <select
        id={id}
        value={value}
        aria-label={`Servings for ${recipeTitle}`}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {multipliers.map((m) => (
          <option key={m} value={m}>
            {m}x
          </option>
        ))}
      </select>
    </div>
  );
}
