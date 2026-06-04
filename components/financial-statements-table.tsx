import { formatCompactCurrency } from "@/lib/format";
import type { FinancialStatements } from "@/lib/marketdata";

const ROWS: Array<{
  label: string;
  key: keyof import("@/lib/marketdata").FinancialPeriod;
}> = [
  { label: "Revenue", key: "totalRevenue" },
  { label: "Gross profit", key: "grossProfit" },
  { label: "Operating income", key: "operatingIncome" },
  { label: "Net income", key: "netIncome" },
  { label: "Operating cash flow", key: "operatingCashflow" },
  { label: "Free cash flow", key: "freeCashflow" },
  { label: "Total assets", key: "totalAssets" },
  { label: "Total debt", key: "totalDebt" },
  { label: "Total equity", key: "totalEquity" },
];

function cell(v: number | null): string {
  return v == null ? "—" : formatCompactCurrency(v);
}

/**
 * Compact multi-year financials, sourced from Yahoo. Columns are fiscal years
 * (newest first); amounts are in the company's reporting currency.
 */
export function FinancialStatementsTable({
  statements,
}: {
  statements: FinancialStatements;
}) {
  const periods = statements.annual;
  if (periods.length === 0) return null;

  return (
    <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold">Financials (annual)</h3>
        <span className="text-[11px] text-muted-2">Yahoo · reporting currency</span>
      </div>
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[13px]">
          <thead>
            <tr className="text-muted">
              <th className="px-2 pb-2 text-left font-medium">Metric</th>
              {periods.map((p, idx) => (
                <th
                  key={idx}
                  className="px-2 pb-2 text-right font-medium tabular-nums"
                >
                  {p.endDate ? p.endDate.getUTCFullYear() : "—"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <td className="px-2 py-2 text-muted">{row.label}</td>
                {periods.map((p, idx) => (
                  <td
                    key={idx}
                    className="px-2 py-2 text-right font-medium tabular-nums"
                  >
                    {cell(p[row.key] as number | null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
