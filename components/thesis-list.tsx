import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { ThesisRecord } from "@/lib/policy/thesis";

const STATUS_LABEL: Record<ThesisRecord["status"], string> = {
  ACTIVE: "Active",
  TRIMMED: "Trimmed",
  EXITED: "Exited",
  INVALIDATED: "Invalidated",
};

const STATUS_TONE: Record<ThesisRecord["status"], string> = {
  ACTIVE: "bg-success/15 text-success",
  TRIMMED: "bg-warning/15 text-warning",
  EXITED: "bg-muted/15 text-muted",
  INVALIDATED: "bg-danger/15 text-danger",
};

export function ThesisList({ theses }: { theses: ThesisRecord[] }) {
  const active = theses.filter((t) => t.status === "ACTIVE");
  return (
    <section className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Theses</h2>
        <span className="text-xs text-muted">
          {active.length} active · {theses.length - active.length} archived
        </span>
      </div>

      {theses.length === 0 ? (
        <div className="border-t border-border px-6 py-8 text-center text-sm text-muted">
          No theses recorded yet. Open any position and use the Thesis tab to
          write down why you own it and what would invalidate the thesis.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {theses.map((t) => (
            <div key={t.id} className="px-4 py-4 md:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/positions/${t.ticker}`}
                  className="text-[14px] font-semibold hover:underline"
                >
                  {t.ticker}
                </Link>
                <div className="flex items-center gap-2">
                  <ConvictionPill
                    rating={t.convictionRating}
                    ratedAt={t.convictionRatedAt}
                  />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[t.status]}`}
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-soft">{t.body}</p>
              {t.invalidationCriteria ? (
                <p className="mt-2 text-[12px] text-muted">
                  <span className="font-semibold text-muted-2">Invalidation: </span>
                  {t.invalidationCriteria}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-2">
                {t.priceTargetCad != null ? (
                  <span>Target {formatCurrency(t.priceTargetCad)}</span>
                ) : null}
                {t.horizonMonths != null ? (
                  <span>Horizon {t.horizonMonths}mo</span>
                ) : null}
                {t.lastReviewedAt ? (
                  <span>
                    Last AI review{" "}
                    {t.lastReviewedAt.toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConvictionPill({
  rating,
  ratedAt,
}: {
  rating: number | null;
  ratedAt: Date | null;
}) {
  const isStale =
    ratedAt == null || Date.now() - ratedAt.getTime() > 90 * 86_400_000;
  if (rating == null) {
    return (
      <span className="rounded-full bg-bg/40 px-2 py-0.5 text-[10px] font-semibold text-muted">
        Unrated
      </span>
    );
  }
  const tone =
    rating >= 7
      ? "bg-success/15 text-success"
      : rating >= 4
        ? "bg-warning/15 text-warning"
        : "bg-danger/15 text-danger";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${tone} ${isStale ? "opacity-60" : ""}`}
      title={isStale ? "Conviction is stale (>90d since rated)" : undefined}
    >
      Conv {rating}/10{isStale ? " ·stale" : ""}
    </span>
  );
}
