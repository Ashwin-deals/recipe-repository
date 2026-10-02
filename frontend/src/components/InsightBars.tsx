import type { Bar } from "../types";

export function InsightBars({ rows, empty }: { rows: Bar[]; empty: string }) {
  if (!rows.length) return <p className="hint">{empty}</p>;
  return (
    <ol className="bars">
      {rows.map((row) => (
        <li className="bar-row" key={row.label}>
          <span className="bar-label">{row.label}</span>
          <span className="bar-track" role="presentation">
            <span className="bar-fill" style={{ width: `${row.percent}%` }} />
          </span>
          <span className="bar-value">{row.count}</span>
        </li>
      ))}
    </ol>
  );
}
