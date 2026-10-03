import { getInsights } from "../api/endpoints";
import { Icon } from "../components/Icon";
import { InsightBars } from "../components/InsightBars";
import { PageHeader } from "../components/PageHeader";
import { ErrorState, LoadingState } from "../components/States";
import { useApi } from "../hooks/useApi";
import { usePageTitle } from "../hooks/usePageTitle";

export function Insights() {
  usePageTitle("Insights");
  const insights = useApi("insights", getInsights);
  const data = insights.data;

  return (
    <div className="insights-page">
      <PageHeader eyebrow="No. 04 · Insights" title="How your kitchen runs">
        {data?.looker_url && (
          <a className="btn btn-ghost" href={data.looker_url} target="_blank" rel="noopener noreferrer">
            <Icon name="chart" />
            <span>Open Looker Studio</span>
          </a>
        )}
      </PageHeader>

      {insights.status === "loading" && <LoadingState label="Crunching the numbers…" kind="cards" />}
      {insights.status === "error" && (
        <ErrorState message={insights.error ?? "Couldn't load insights."} onRetry={() => void insights.reload()} />
      )}
      {data && (
        <>
          <ul className="stats">
            <Stat value={data.counts.recipes} label="recipes saved" />
            <Stat value={data.counts.open_items} label="items to buy" />
            <Stat value={data.counts.lists_built} label="recipes added to lists" />
            <Stat value={data.counts.trips} label="lists cleared" />
            <Stat value={data.ai_calls} suffix={`/${data.ai_cap}`} label="AI calls today" />
          </ul>

          <div className="insight-grid">
            <section className="panel" aria-labelledby="top-recipes">
              <h2 id="top-recipes">Most-added recipes</h2>
              <InsightBars rows={data.top_recipes} empty="Add a recipe to your list and it shows up here." />
            </section>
            <section className="panel" aria-labelledby="top-items">
              <h2 id="top-items">Most-bought ingredients</h2>
              <InsightBars rows={data.top_items} empty="Tick items off in the store and the most bought appear here." />
            </section>
            <section className="panel panel-wide" aria-labelledby="trends">
              <h2 id="trends">Category trends</h2>
              <div className="legend">
                <span><span className="key key-saved" /> Recipes saved</span>
                <span><span className="key key-added" /> Times added to a list</span>
              </div>
              <ol className="bars bars-paired">
                {data.categories.map((c) => (
                  <li className="bar-row" key={c.label}>
                    <span className="bar-label">
                      {c.label}
                      <small>{c.recent} added in the last 7 days</small>
                    </span>
                    <span className="bar-pair" role="presentation">
                      <span className="bar-track">
                        <span className="bar-fill bar-saved" style={{ width: `${c.saved_percent}%` }} />
                      </span>
                      <span className="bar-track">
                        <span className={`bar-fill bar-added bar-${c.label.toLowerCase()}`} style={{ width: `${c.added_percent}%` }} />
                      </span>
                    </span>
                    <span className="bar-value" aria-label={`${c.saved} saved, ${c.added} added`}>
                      {c.saved} / {c.added}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ value, label, suffix }: { value: number; label: string; suffix?: string }) {
  return (
    <li className="stat">
      <span className="stat-value">
        {value}
        {suffix && <small>{suffix}</small>}
      </span>
      <span className="stat-label">{label}</span>
    </li>
  );
}
