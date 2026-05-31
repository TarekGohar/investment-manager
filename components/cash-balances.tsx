import type { CashSummary } from "@/lib/portfolio/cash";

const KIND_LABEL: Record<string, string> = {
  NON_REGISTERED: "Non-reg",
  JOINT_NON_REGISTERED: "Joint non-reg",
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RESP: "RESP",
  LIRA: "LIRA",
  RRIF: "RRIF",
  CORPORATE: "Corporate",
};

function formatMoney(amount: number, currency: string): string {
  return amount.toLocaleString("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function CashBalances({ summary }: { summary: CashSummary }) {
  const currencies = Object.keys(summary.totalsByCurrency).sort();
  const anyActivity =
    summary.byBrokerage.some(
      (b) => b.balance !== 0 || b.totalDeposits !== 0 || b.totalWithdrawals !== 0,
    );

  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Cash balances</h2>
        {currencies.length > 0 && anyActivity ? (
          <div className="flex flex-wrap items-baseline gap-3 text-xs text-muted">
            {currencies.map((c) => (
              <span key={c}>
                <span className="font-semibold text-text">
                  {formatMoney(summary.totalsByCurrency[c], c)}
                </span>{" "}
                <span className="text-muted-2">{c}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {!anyActivity ? (
        <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
          No cash flows recorded. Use the transaction form to log a Deposit
          when you fund an account, or a Withdraw when you pull money out.
          Buys, sells, and dividends update the cash balance automatically.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.4fr_0.8fr_1fr_1fr_1fr] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
              <div>Account</div>
              <div className="text-right">Currency</div>
              <div className="text-right">Cash balance</div>
              <div className="text-right">Deposited (lifetime)</div>
              <div className="text-right">Withdrawn (lifetime)</div>
            </div>
            {summary.byBrokerage.map((b) => (
              <div
                key={b.brokerageId}
                className="grid grid-cols-[1.4fr_0.8fr_1fr_1fr_1fr] items-center gap-3 border-t border-border px-4 py-3 md:px-6"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">
                    {b.brokerageName}
                  </div>
                  <div className="text-xs text-muted">
                    {KIND_LABEL[b.brokerageKind] ?? b.brokerageKind}
                  </div>
                </div>
                <div className="text-right text-[13px] text-muted">{b.currency}</div>
                <div
                  className={`text-right text-[14px] font-semibold tabular-nums ${
                    b.balance < 0 ? "text-danger" : b.balance > 0 ? "text-success" : "text-muted"
                  }`}
                >
                  {formatMoney(b.balance, b.currency)}
                </div>
                <div className="text-right text-[14px] tabular-nums text-muted">
                  {b.totalDeposits > 0 ? formatMoney(b.totalDeposits, b.currency) : "—"}
                </div>
                <div className="text-right text-[14px] tabular-nums text-muted">
                  {b.totalWithdrawals > 0 ? formatMoney(b.totalWithdrawals, b.currency) : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="border-t border-border px-4 py-3 text-xs text-muted-2 md:px-6">
        Cash balance = deposits + sells + dividends (net of FWT) − withdrawals
        − buys (with fees). A negative balance usually means a buy or
        withdrawal was entered before the deposit that funded it — log the
        deposit and the balance will resolve. Cross-currency totals aren&apos;t
        converted; each currency tallies separately.
      </p>
    </section>
  );
}
