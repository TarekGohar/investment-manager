import Link from "next/link";
import { Markdown } from "@/components/markdown";

export type FilingListItem = {
  id: string;
  type: string;
  source: string;
  url: string;
  title: string | null;
  filedAt: Date;
};

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
  ANNUAL_INFO_FORM: "AIF",
  MD_AND_A: "MD&A",
  ANNUAL_FINANCIAL_STATEMENTS: "Annual financials",
  INTERIM_FINANCIAL_STATEMENTS: "Interim financials",
  MATERIAL_CHANGE_REPORT: "Material change",
  OTHER: "Filing",
};

export function FilingsTab({
  ticker,
  filings,
  latestSummary,
  sedarUrl,
  isUsListed,
}: {
  ticker: string;
  filings: FilingListItem[];
  latestSummary: LatestQuarterlySummary | null;
  sedarUrl: string;
  isUsListed: boolean;
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
              : " AI summarization is currently US-listed (EDGAR) only — see the link below for SEDAR+ filings."}
          </div>
        )}
      </section>

      {/* Filing history list */}
      <section className="rounded-card border border-border bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-5">
          <h3 className="text-[16px] font-semibold">Filing history</h3>
          <a
            href={sedarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted underline"
          >
            Search SEDAR+ for {ticker} →
          </a>
        </div>
        {filings.length === 0 ? (
          <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
            No filings indexed yet for this ticker.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[1fr_2.5fr_1fr_0.6fr] gap-3 border-t border-border px-6 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                <div>Form</div>
                <div>Title</div>
                <div>Filed</div>
                <div className="text-right">Open</div>
              </div>
              {filings.map((f) => (
                <div
                  key={f.id}
                  className="grid grid-cols-[1fr_2.5fr_1fr_0.6fr] items-center gap-3 border-t border-border px-6 py-3"
                >
                  <div className="text-[14px] font-semibold">
                    {FILING_TYPE_LABEL[f.type] ?? f.type}
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-2">
                      {f.source === "EDGAR" ? "EDGAR" : "SEDAR+"}
                    </span>
                  </div>
                  <div className="truncate text-[13px] text-soft">
                    {f.title ?? "—"}
                  </div>
                  <div className="text-[13px] text-muted">
                    {f.filedAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <div className="text-right">
                    <Link
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-brand-2 hover:underline"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
