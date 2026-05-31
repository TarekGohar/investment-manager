import type { CorrelationData } from "@/lib/portfolio/performance-summary";

/**
 * Pairwise correlation heatmap. Diagonal is 1; off-diagonal cells use a
 * blue/red diverging palette around 0.
 */
export function CorrelationHeatmap({ data }: { data: CorrelationData }) {
  const { tickers, matrix } = data;
  if (tickers.length < 2) return null;

  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Correlation matrix</h2>
        <span className="text-xs text-muted">
          Daily returns · ~200 trading days
        </span>
      </div>
      <div className="overflow-x-auto px-4 pb-5 md:px-6">
        <table className="min-w-fit border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-panel pr-2 text-left font-semibold text-muted">
                &nbsp;
              </th>
              {tickers.map((t) => (
                <th
                  key={t}
                  className="px-1 py-1 text-center font-mono font-semibold text-muted"
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((row, i) => (
              <tr key={row}>
                <th className="sticky left-0 z-10 bg-panel pr-2 text-right font-mono font-semibold text-muted">
                  {row}
                </th>
                {tickers.map((_, j) => {
                  const v = matrix[i][j];
                  return (
                    <td
                      key={j}
                      className="border border-bg/40 px-2 py-1.5 text-center tabular-nums"
                      style={cellStyle(v)}
                      title={v == null ? "n/a" : v.toFixed(2)}
                    >
                      {v == null ? "—" : v.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-2 md:px-6">
        Pairs with overlap &lt; 10 days show &ldquo;—&rdquo;. Lower correlations
        indicate better diversification benefit.
      </p>
    </section>
  );
}

function cellStyle(v: number | null): { background: string; color: string } {
  if (v == null) return { background: "transparent", color: "var(--color-muted)" };
  // Map -1..1 to a red-white-blue gradient
  const clamped = Math.max(-1, Math.min(1, v));
  if (clamped >= 0) {
    const intensity = Math.round(clamped * 80);
    return {
      background: `rgba(59, 130, 246, ${0.08 + (clamped * 0.55)})`,
      color: intensity > 50 ? "white" : "var(--color-text)",
    };
  }
  const intensity = Math.round(-clamped * 80);
  return {
    background: `rgba(239, 68, 68, ${0.08 + (-clamped * 0.55)})`,
    color: intensity > 50 ? "white" : "var(--color-text)",
  };
}
