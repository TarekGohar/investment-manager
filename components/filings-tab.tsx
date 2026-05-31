import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { CseListingLinker } from "@/components/cse-listing-linker";
import { formatCurrency } from "@/lib/format";
import type { UnifiedFiling, UnifiedInsiderTransaction } from "@/lib/filings";

export type LatestQuarterlySummary = {
  id: string;
  title: string | null;
  body: string;
  generatedAt: Date;
  filingId: string | null;
};

const FILING_TYPE_LABEL: Record<string, string> = {
  TEN_K: "10-K",
  TEN_Q: "10-Q",
  EIGHT_K: "8-K",
  FORTY_F: "40-F",
  SIX_K: "6-K",
  TWENTY_F: "20-F",
  F_10: "F-10",
  F_X: "F-X",
  F_3: "F-3",
  ANNUAL_INFO_FORM: "AIF",
  MD_AND_A: "MD&A",
  ANNUAL_FINANCIAL_STATEMENTS: "Annual financials",
  INTERIM_FINANCIAL_STATEMENTS: "Interim financials",
  MATERIAL_CHANGE_REPORT: "Material change",
  OTHER: "Filing",
};

const SOURCE_TONE: Record<string, string> = {
  EDGAR: "bg-brand/10 text-brand-2",
  CSE: "bg-success/15 text-success",
  TMX: "bg-warning/15 text-warning",
};

export function FilingsTab({
  ticker,
  filings,
  insiderTransactions,
  latestSummary,
  isUsListed,
  hasCseListing,
  isCseTicker,
}: {
  ticker: string;
  filings: UnifiedFiling[];
  insiderTransactions: UnifiedInsiderTransaction[];
  latestSummary: LatestQuarterlySummary | null;
  isUsListed: boolean;
  hasCseListing: boolean;
  isCseTicker: boolean;
}) {
  return (
    <div className="space-y-[26px]">
      {/* Latest AI quarterly read */}
      <section className="rounded-card border border-border bg-panel px-6 py-[22px]">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[16px] font-semibold">Latest AI quarterly read</h3>
          {latestSummary ? (
            <span className="text-xs text-muted">
              Generated{" "}
              {latestSummary.generatedAt.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </div>

        {latestSummary ? (
          <>
            {latestSummary.title ? (
              <div className="mb-3 text-sm font-semibold text-soft">
                {latestSummary.title}
              </div>
            ) : null}
            <div className="prose-pm">
              <Markdown>{latestSummary.body}</Markdown>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted">
            No AI quarterly read for <span className="font-mono">{ticker}</span>{" "}
            yet.
            {isUsListed
              ? " The daily filings cron will generate one once a 10-Q or 10-K is detected for your holdings."
              : hasCseListing
                ? " AI summarization for CSE filings is queued — the cron currently runs on EDGAR only."
                : " Link this ticker to its CSE / SEDAR listing below and the AI will start summarizing filings."}
          </div>
        )}
      </section>

      {/* CSE listing linker — shown for .CN tickers without a saved listing */}
      {isCseTicker && !hasCseListing ? (
        <CseListingLinker ticker={ticker} />
      ) : null}

      {/* Filing history list */}
      <section className="rounded-card border border-border bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-5">
          <h3 className="text-[16px] font-semibold">Filing history</h3>
          <span className="text-xs text-muted">
            {filings.length} filing{filings.length === 1 ? "" : "s"}
            {filings.length > 0
              ? ` · ${Array.from(new Set(filings.map((f) => f.source))).join(", ")}`
              : ""}
          </span>
        </div>
        {filings.length === 0 ? (
          <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
            No filings indexed yet for this ticker.
            {!isUsListed && !hasCseListing
              ? " For Canadian-listed names, link a CSE listing URL above to populate filings."
              : ""}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[1.2fr_2.5fr_1fr_0.6fr] gap-3 border-t border-border px-6 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                <div>Form</div>
                <div>Title</div>
                <div>Filed</div>
                <div className="text-right">Open</div>
              </div>
              {filings.map((f, i) => (
                <div
                  key={f.externalId ?? `${f.source}-${i}`}
                  className="grid grid-cols-[1.2fr_2.5fr_1fr_0.6fr] items-center gap-3 border-t border-border px-6 py-3"
                >
                  <div className="text-[14px] font-semibold">
                    {FILING_TYPE_LABEL[f.type] ?? f.type}
                    <span
                      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${SOURCE_TONE[f.source] ?? "bg-muted/15 text-muted"}`}
                    >
                      {f.source}
                    </span>
                  </div>
                  <div className="truncate text-[13px] text-soft" title={f.title}>
                    {f.title}
                    {f.categoryLabel && f.categoryLabel !== f.title ? (
                      <span className="ml-1 text-muted-2"> · {f.categoryLabel}</span>
                    ) : null}
                  </div>
                  <div className="text-[13px] text-muted">
                    {f.filedAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <div className="text-right">
                    {f.url ? (
                      <Link
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-brand-2 hover:underline"
                      >
                        View
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-2">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Insider activity — US only via EDGAR Form 4 */}
      {insiderTransactions.length > 0 ? (
        <section className="rounded-card border border-border bg-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-5">
            <h3 className="text-[16px] font-semibold">Insider activity</h3>
            <span className="text-xs text-muted">
              {insiderTransactions.length} transaction{insiderTransactions.length === 1 ? "" : "s"} ·
              from EDGAR Form 4
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-[1.4fr_0.9fr_0.6fr_0.8fr_0.9fr_0.9fr] gap-3 border-t border-border px-6 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                <div>Insider</div>
                <div>Date</div>
                <div>Code</div>
                <div className="text-right">A/D</div>
                <div className="text-right">Shares</div>
                <div className="text-right">Price</div>
              </div>
              {insiderTransactions.slice(0, 25).map((t, i) => (
                <div
                  key={`${t.accessionNumber}-${i}`}
                  className="grid grid-cols-[1.4fr_0.9fr_0.6fr_0.8fr_0.9fr_0.9fr] items-center gap-3 border-t border-border px-6 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{t.insiderName}</div>
                    {t.insiderTitle ? (
                      <div className="truncate text-[11px] text-muted">{t.insiderTitle}</div>
                    ) : null}
                  </div>
                  <div className="text-[13px] text-muted">
                    {t.transactionDate.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <div className="text-[12px] font-mono text-muted">
                    {t.transactionCode ?? "—"}
                  </div>
                  <div
                    className={`text-right text-[13px] font-semibold ${
                      t.acquiredOrDisposed === "A"
                        ? "text-success"
                        : t.acquiredOrDisposed === "D"
                          ? "text-danger"
                          : "text-muted"
                    }`}
                  >
                    {t.acquiredOrDisposed === "A"
                      ? "Buy"
                      : t.acquiredOrDisposed === "D"
                        ? "Sell"
                        : "—"}
                  </div>
                  <div className="text-right text-[13px] tabular-nums">
                    {t.shares != null ? t.shares.toLocaleString() : "—"}
                  </div>
                  <div className="text-right text-[13px] tabular-nums">
                    {t.pricePerShare != null
                      ? formatCurrency(t.pricePerShare)
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="border-t border-border px-6 py-3 text-xs text-muted-2">
            Codes: P = open-market purchase, S = open-market sale, M = option
            exercise, G = gift, A = grant. A/D = acquired or disposed.
          </p>
        </section>
      ) : null}
    </div>
  );
}
