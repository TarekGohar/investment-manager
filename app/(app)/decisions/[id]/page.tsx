import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { auth } from "@/lib/auth";
import { getDecisionCard } from "@/lib/alerts/hub";
import { getDecisionHistoryForTicker } from "@/lib/alerts/retrospective";
import { RULE_LABEL } from "@/lib/signals/types";
import { getHolding } from "@/lib/portfolio/queries";
import { getQuote } from "@/lib/marketdata";
import { DecisionOutcomeForm } from "@/components/decision-outcome-form";
import { Markdown } from "@/components/markdown";
import { NotificationActionPanel } from "@/components/notification-action-panel";
import type {
  AlertSource,
  RecommendedAction,
  DecisionOutcome,
} from "@/generated/prisma";

const ACTION_LABEL: Record<RecommendedAction, string> = {
  ADD: "Add",
  TRIM: "Trim",
  EXIT: "Exit",
  HOLD_THROUGH_DRAWDOWN: "Hold through drawdown",
  DEPLOY_ELSEWHERE: "Deploy elsewhere",
  HARVEST_LOSS: "Harvest loss",
  REBALANCE: "Rebalance",
  REVIEW_THESIS: "Review thesis",
  NONE: "No action",
};

const OUTCOME_LABEL: Record<DecisionOutcome, string> = {
  OPEN: "Open",
  EXECUTED_AS_RECOMMENDED: "Executed as recommended",
  EXECUTED_REVISED: "Executed with changes",
  ABANDONED: "Abandoned",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export default async function DecisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const event = await getDecisionCard({ userId: session.user.id, eventId: id });
  if (!event) notFound();

  const action = event.recommendedAction;
  const priorOnTicker = event.ticker
    ? (await getDecisionHistoryForTicker({
        userId: session.user.id,
        ticker: event.ticker,
        limit: 6,
      })).filter((r) => r.eventId !== event.id)
    : [];

  // Pull the live position + quote so the outcome form can offer a "Max"
  // (held shares) button and a "Use $X" (current market) prefill.
  const [holding, quote] = event.ticker
    ? await Promise.all([
        getHolding(session.user.id, event.ticker),
        getQuote(event.ticker).catch(() => null),
      ])
    : [null, null];

  const isSellAction =
    action === "TRIM" || action === "EXIT" || action === "HARVEST_LOSS";
  // For HARVEST_LOSS, the legal max is the non-reg pool only (registered
  // losses aren't deductible — the weekly review rule now blocks proposing
  // it there at all, but be defensive at the UI). For TRIM / EXIT, allow
  // the full position.
  const maxQuantity =
    holding == null
      ? null
      : action === "HARVEST_LOSS"
        ? holding.nonRegQuantity
        : isSellAction
          ? holding.quantity
          : null;
  // Buy-type actions previously carried a recommended quantity via the now-
  // deprecated actionDetails field. With the schema simplification, the
  // structured DEGREE numbers in sizingDetails cover this — but for the
  // outcome form's "Recommended" button we read from sizingDetails when set.
  const recommendedQuantity =
    !isSellAction &&
    event.sizingDetails &&
    typeof (event.sizingDetails as Record<string, unknown>).expectedSharesDelta === "number"
      ? Math.abs(
          (event.sizingDetails as Record<string, unknown>).expectedSharesDelta as number,
        )
      : null;

  return (
    <>
      <Topbar title={action ? "Decision detail" : "Notification detail"} />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <Link href="/decisions" className="mb-4 inline-block text-xs text-muted hover:text-text">
          ← Back to inbox
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <article className="space-y-6">
            <header className="rounded-card border border-border bg-panel p-5">
              {/* WHAT: action verb + ticker, the focal point. */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {action && (
                  <h1 className="text-[22px] font-semibold tracking-tight">
                    {ACTION_LABEL[action]}
                  </h1>
                )}
                {event.ticker ? (
                  <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 font-mono text-sm font-semibold">
                    {event.ticker}
                  </span>
                ) : (
                  <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 text-sm font-semibold text-muted">
                    Portfolio
                  </span>
                )}
              </div>
              {/* Status row: only render badges that actually signal. MATERIAL
                  is the default (everyone's a MATERIAL) so hide it; only
                  URGENT and INFO carry information. Outcome shows only after
                  the decision is closed (presence of the form below already
                  signals OPEN). */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {event.urgency !== "MATERIAL" && <UrgencyBadge urgency={event.urgency} />}
                {action && event.outcome !== "OPEN" && (
                  <OutcomeBadge outcome={event.outcome} />
                )}
                {!action && (
                  <span className="rounded-[6px] border border-border bg-bg/40 px-2 py-0.5 text-muted">
                    Notification
                  </span>
                )}
                <span
                  className="ml-auto text-muted"
                  title={`${event.firedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}
                >
                  {formatRelativeTime(event.firedAt)}
                </span>
              </div>
              <div className="mt-3 text-sm">
                <Markdown>{event.message}</Markdown>
              </div>
              <SourceLine event={event} />
            </header>

            {/* WHY: one prose card. For new decisions this is just rationale.
                For old decisions, falsifier + review + alternatives + sizing
                prose all get folded in as labelled clauses so nothing is
                lost from the existing inbox. */}
            <ScanCard title="Why">
              <div className="text-sm">
                <Markdown>{composeRationale(event)}</Markdown>
              </div>
            </ScanCard>

            {/* DEGREE: structured numbers. How much. Hidden entirely when
                there's nothing to show (HOLD_THROUGH_DRAWDOWN, etc.). */}
            <DegreeRow sizingDetails={event.sizingDetails as Record<string, unknown> | null} />

            {/* Small footer line for review countdown when set. */}
            {event.reviewByDate && (
              <p className="text-xs text-muted">
                Review by {event.reviewByDate.toISOString().slice(0, 10)}{" "}
                <span className="text-muted-2">
                  ({formatReviewCountdown(event.reviewByDate)})
                </span>
              </p>
            )}

            {event.outcome !== "OPEN" && (
              <Section title="Outcome">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="text-muted">Status</div>
                  <div>{OUTCOME_LABEL[event.outcome]}</div>
                  {event.outcomeExecutedQuantity != null && (
                    <>
                      <div className="text-muted">Executed quantity</div>
                      <div className="tabular-nums">
                        {event.outcomeExecutedQuantity.toString()}
                      </div>
                    </>
                  )}
                  {event.outcomeExecutedPrice != null && (
                    <>
                      <div className="text-muted">Executed price</div>
                      <div className="tabular-nums">
                        {event.outcomeExecutedPrice.toString()}
                      </div>
                    </>
                  )}
                  {event.outcomeRecordedAt && (
                    <>
                      <div className="text-muted">Recorded at</div>
                      <div>
                        {event.outcomeRecordedAt.toISOString().slice(0, 16).replace("T", " ")}{" "}
                        UTC
                      </div>
                    </>
                  )}
                </dl>
                {event.outcomeNotes && (
                  <p className="mt-3 text-sm italic text-muted">{event.outcomeNotes}</p>
                )}
              </Section>
            )}
          </article>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            {priorOnTicker.length > 0 && (
              <PriorDecisionsSidebar ticker={event.ticker} prior={priorOnTicker} />
            )}
            {action ? (
              event.outcome === "OPEN" ? (
                <DecisionOutcomeForm
                  eventId={event.id}
                  recommendedAction={action}
                  maxQuantity={maxQuantity}
                  recommendedQuantity={recommendedQuantity}
                  marketPrice={quote?.price ?? null}
                />
              ) : (
                <div className="rounded-card border border-border bg-panel p-5">
                  <h3 className="text-sm font-semibold">Decision closed</h3>
                  <p className="mt-2 text-xs text-muted">
                    This decision was closed on{" "}
                    {event.outcomeRecordedAt?.toISOString().slice(0, 10) ?? "—"}. Closed
                    decisions are immutable. If you want to revisit, raise a fresh
                    decision from the position page or in chat.
                  </p>
                </div>
              )
            ) : (
              <NotificationActionPanel eventId={event.id} read={event.read} />
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function SourceLine({
  event,
}: {
  event: Awaited<ReturnType<typeof getDecisionCard>>;
}) {
  if (!event) return null;
  // Tight: "via AI chat · [chat ↗]". The rule label is debugging detail —
  // dropped from the default view.
  return (
    <p className="mt-3 text-xs text-muted">
      via {SOURCE_DESCRIPTION[event.source]}
      {event.conversation && (
        <>
          {" · "}
          <Link
            href={`/chat?conversation=${event.conversation.id}`}
            className="text-brand-2 hover:underline"
          >
            chat ↗
          </Link>
        </>
      )}
    </p>
  );
}

const SOURCE_DESCRIPTION: Record<AlertSource, string> = {
  CRON_RULE: "scheduled rule",
  AI_CHAT: "AI chat",
  DAILY_REVIEW: "daily review",
  WEEKLY_REVIEW: "weekly review",
  ANNUAL_REVIEW: "annual review",
  MANUAL: "manual entry",
};

// Compose the WHY prose. The schema-simplified version stores everything in
// a single `rationale` field — falsifier, review trigger, alternatives all
// as inline clauses inside that one paragraph. This function is a thin
// pass-through for now; left as a function so the page can grow new
// composition logic without touching the JSX.
function composeRationale(
  event: NonNullable<Awaited<ReturnType<typeof getDecisionCard>>>,
): string {
  return event.rationale ?? event.message;
}

// DEGREE row — structured "how much." Renders only when sizingDetails carries
// at least one of the standardized keys. Compact horizontal layout, not a
// stacked dl-grid.
function DegreeRow({
  sizingDetails,
}: {
  sizingDetails: Record<string, unknown> | null;
}) {
  if (!sizingDetails) return null;
  // Accept canonical keys first, fall back to legacy keys used by old
  // decisions raised before the schema simplification. Maps:
  //   currentPositionPctOfNav → currentWeightPct
  //   targetMaxSingleNameWeightPct → targetWeightPct
  //   nominalUsd → expectedDollarDelta
  const target =
    num(sizingDetails.targetWeightPct) ??
    num(sizingDetails.targetMaxSingleNameWeightPct);
  const current =
    num(sizingDetails.currentWeightPct) ??
    num(sizingDetails.currentPositionPctOfNav);
  const sharesDelta = num(sizingDetails.expectedSharesDelta);
  const dollarDelta =
    num(sizingDetails.expectedDollarDelta) ?? num(sizingDetails.nominalUsd);

  const chips: { label: string; value: string }[] = [];
  if (current != null && target != null) {
    chips.push({
      label: "Weight",
      value: `${current.toFixed(2)}% → ${target.toFixed(2)}% of NAV`,
    });
  } else if (target != null) {
    chips.push({ label: "Target weight", value: `${target.toFixed(2)}% of NAV` });
  } else if (current != null) {
    chips.push({ label: "Current weight", value: `${current.toFixed(2)}% of NAV` });
  }
  if (sharesDelta != null) {
    const verb = sharesDelta < 0 ? "Sell" : "Buy";
    chips.push({ label: verb, value: `${Math.abs(sharesDelta).toFixed(0)} shares` });
  }
  if (dollarDelta != null) {
    const sign = dollarDelta < 0 ? "Free up" : "Deploy";
    chips.push({
      label: sign,
      value: `$${Math.abs(dollarDelta).toLocaleString(undefined, { maximumFractionDigits: 0 })} CAD`,
    });
  }
  if (chips.length === 0) return null;

  return (
    <section className="rounded-card border border-border bg-panel p-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Degree
      </h3>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {chips.map((c) => (
          <div key={c.label} className="flex items-baseline gap-1.5">
            <span className="text-muted">{c.label}</span>
            <span className="font-semibold tabular-nums">{c.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

// Sidebar prior-decisions list. Default view is a one-line summary
// (count + outcome breakdown). Full list expands via <details>. The pattern
// (executed vs abandoned counts) carries more retrospective signal than the
// raw list anyway.
function PriorDecisionsSidebar({
  ticker,
  prior,
}: {
  ticker: string | null;
  prior: Awaited<ReturnType<typeof getDecisionHistoryForTicker>>;
}) {
  const buckets = {
    executed: 0,
    abandoned: 0,
    rejected: 0,
    open: 0,
    expired: 0,
  };
  for (const r of prior) {
    if (r.outcome === "EXECUTED_AS_RECOMMENDED" || r.outcome === "EXECUTED_REVISED") buckets.executed++;
    else if (r.outcome === "ABANDONED") buckets.abandoned++;
    else if (r.outcome === "REJECTED") buckets.rejected++;
    else if (r.outcome === "EXPIRED") buckets.expired++;
    else buckets.open++;
  }
  const parts: string[] = [];
  if (buckets.executed > 0) parts.push(`${buckets.executed} executed`);
  if (buckets.abandoned > 0) parts.push(`${buckets.abandoned} abandoned`);
  if (buckets.rejected > 0) parts.push(`${buckets.rejected} rejected`);
  if (buckets.open > 0) parts.push(`${buckets.open} open`);
  if (buckets.expired > 0) parts.push(`${buckets.expired} expired`);

  return (
    <section className="rounded-card border border-border bg-panel p-4">
      <details className="group">
        <summary className="flex cursor-pointer items-center justify-between gap-2 list-none">
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              Prior on {ticker}
            </h3>
            <p className="mt-0.5 text-xs text-text">
              {prior.length} prior · {parts.join(" · ") || "none closed yet"}
            </p>
          </div>
          <Chevron />
        </summary>
        <ul className="mt-3 space-y-1.5">
          {prior.map((r) => (
            <li key={r.eventId} className="text-xs">
              <Link
                href={`/decisions/${r.eventId}`}
                className="block rounded-[6px] bg-bg/30 px-2 py-1.5 hover:bg-bg/60"
              >
                <div className="flex items-center justify-between gap-2 text-muted">
                  <span>
                    {r.action} · {r.source}
                  </span>
                  <span className="tabular-nums">
                    {r.firedAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                <div className="text-[11px] text-muted-2">
                  {r.outcome === "OPEN" ? "Open" : r.outcome.replace(/_/g, " ").toLowerCase()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// Plain panel section. Kept for the closed-decision "Outcome" block (the
// only remaining non-collapsible, non-scan section).
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-panel p-5">
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

// Top-of-page scan card. The `accent` flag adds a brand-2 left border and
// tint, used for the Guardrails (falsifier + review) card so the two most
// time-sensitive pieces of info read as the focal column.
function ScanCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  const base = "rounded-card border border-border p-5";
  // Symmetric tint (no asymmetric left border) — keeps the focal column
  // visually distinct from "Why" without the lopsided treatment.
  const tone = accent ? "bg-brand-2/5" : "bg-panel";
  return (
    <section className={`${base} ${tone}`}>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

// Frozen-numbers band. Splits scalar values (rendered as inline chips for
// quick scanning) from nested object values (rendered as their own subcards
// — e.g. specialist memo summaries shaped { confidence, keyFindings } that
// the CIO synthesis attaches as supportingEvidence).
function NumberChipsBand({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown>;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  const scalars = entries.filter(
    ([, v]) => v === null || typeof v !== "object",
  );
  const nested = entries.filter(
    ([, v]) => v !== null && typeof v === "object",
  );
  if (scalars.length === 0 && nested.length === 0) return null;

  return (
    <section className="space-y-3 rounded-card border border-border bg-panel p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {scalars.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {scalars.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5">
              <span className="text-muted">{humanizeKey(k)}</span>
              <span className="font-semibold tabular-nums">{formatValue(k, v)}</span>
            </div>
          ))}
        </div>
      )}
      {nested.length > 0 && (
        <div className="space-y-2">
          {nested.map(([k, v]) => (
            <NestedEvidenceCard
              key={k}
              title={humanizeKey(k)}
              data={v as Record<string, unknown>}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// Renders one nested supportingEvidence entry. Detects the specialist-memo
// shape { confidence, keyFindings: string[] } and gives it a tailored
// look (confidence badge + bulleted findings). Falls back to the generic
// EvidenceTable for any other nested object.
function NestedEvidenceCard({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown>;
}) {
  const isMemo =
    typeof data.confidence === "string" &&
    Array.isArray(data.keyFindings) &&
    (data.keyFindings as unknown[]).every((x) => typeof x === "string");
  if (isMemo) {
    const confidence = String(data.confidence);
    const findings = data.keyFindings as string[];
    return (
      <div className="rounded-[8px] border border-border bg-bg/30 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">{title}</span>
          <ConfidenceBadge confidence={confidence} />
        </div>
        <ul className="space-y-1 text-sm">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-2">·</span>
              <span>{renderInlineMarkdown(f)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="rounded-[8px] border border-border bg-bg/30 p-3">
      <div className="mb-2 text-[13px] font-semibold">{title}</div>
      <EvidenceTable data={data} />
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const c = confidence.toLowerCase();
  const cls =
    c === "high"
      ? "border-success/40 bg-success/10 text-success"
      : c === "medium"
        ? "border-border bg-bg/40 text-text"
        : c === "low" || c === "insufficient"
          ? "border-border bg-bg/40 text-muted"
          : "border-border bg-bg/40 text-muted";
  return (
    <span
      className={`rounded-[6px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {c}
    </span>
  );
}

// Native <details> collapsible. Closed by default; opens via summary click.
// Group-based chevron rotation requires Tailwind's `group` modifier.
function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-card border border-border bg-panel">
      <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-[13px] font-semibold uppercase tracking-wide text-muted hover:text-text">
        <span>{title}</span>
        <Chevron />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform group-open:rotate-180"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ActionDetailsTable({ details }: { details: Record<string, unknown> }) {
  return <EvidenceTable data={details} />;
}

function EvidenceTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-xs text-muted">—</p>;
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{humanizeKey(k)}</dt>
          <dd className="tabular-nums">{formatValue(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

// Format a value with awareness of what it is, inferred from the key name.
// Percent fields (anything ending in Pct, containing Percent, Weight, Pnl,
// Drift) get a "%" suffix. Money fields (Price, Cost, Value, Nav, Amount)
// get a "$" prefix and 2-decimal formatting. Quantity / Shares get integer.
// Everything else falls through to toLocaleString.
function formatValue(key: string, v: unknown): React.ReactNode {
  if (v == null) return <span className="text-muted">—</span>;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (typeof v !== "number") return JSON.stringify(v);

  const k = key.toLowerCase();
  // Percent detection wins over money detection. Match `pct` ANYWHERE in the
  // key (not just at the end) so `excessPctOfNav` and `currentPositionPctOfNav`
  // format as % instead of being clobbered by the `nav` → $ rule.
  const isPercent =
    /pct/i.test(key) ||
    k.includes("percent") ||
    k.includes("weight") ||
    k.includes("pnl") ||
    k.includes("drift") ||
    k.includes("margin") ||
    k.includes("yield");
  const isMoney =
    !isPercent &&
    (k.includes("price") ||
      k.includes("cost") ||
      k.includes("value") ||
      k.includes("nav") ||
      k.includes("amount") ||
      k.includes("usd") ||
      k.includes("cad") ||
      k.includes("balance"));
  const isInteger = !isPercent && !isMoney && (k.includes("quantity") || k.includes("shares"));

  let str: string;
  if (isPercent) {
    str = `${v.toFixed(2)}%`;
  } else if (isMoney) {
    const abs = Math.abs(v);
    str = `${v < 0 ? "-" : ""}$${abs < 1 ? abs.toFixed(4) : abs.toFixed(2)}`;
  } else if (isInteger) {
    str = Math.round(v).toLocaleString();
  } else {
    str = v.toLocaleString();
  }
  // Subtle directional color for return-ish percent fields.
  if (isPercent && /pnl|drift/.test(k)) {
    const tone = v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted";
    return <span className={tone}>{str}</span>;
  }
  return str;
}

function humanizeKey(k: string): string {
  // camelCase / snake_case → "Camel case"
  return k
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\bpct\b/gi, "%")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

function UrgencyBadge({ urgency }: { urgency: "INFO" | "MATERIAL" | "URGENT" }) {
  const cls =
    urgency === "URGENT"
      ? "border-danger/40 bg-danger/10 text-danger"
      : urgency === "MATERIAL"
        ? "border-border bg-bg/40 text-text"
        : "border-border bg-bg/40 text-muted";
  return (
    <span className={`rounded-[6px] border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {urgency}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: DecisionOutcome }) {
  const cls =
    outcome === "OPEN"
      ? "border-brand-2/40 bg-brand-2/10 text-brand-2"
      : outcome === "EXECUTED_AS_RECOMMENDED"
        ? "border-success/40 bg-success/10 text-success"
        : outcome === "EXECUTED_REVISED"
          ? "border-success/30 bg-success/5 text-success"
          : outcome === "REJECTED"
            ? "border-danger/40 bg-danger/10 text-danger"
            : "border-border bg-bg/40 text-muted";
  return (
    <span className={`rounded-[6px] border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function formatRelativeTime(d: Date, now: Date = new Date()): string {
  const ms = now.getTime() - d.getTime();
  if (ms < 0) return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = (days / 365).toFixed(1);
  return `${years} years ago`;
}

// Inline-only markdown for short text inside contexts where a paragraph
// wrapper would break the layout (e.g. <li> elements in the specialist
// keyFindings list). Handles **bold** and *italic*; everything else is
// left as plain text. For multi-paragraph prose, use <Markdown> instead.
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] != null) {
      parts.push(
        <strong key={`b-${i++}`} className="font-semibold text-text">
          {match[1]}
        </strong>,
      );
    } else if (match[2] != null) {
      parts.push(
        <em key={`i-${i++}`} className="italic">
          {match[2]}
        </em>,
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

function formatReviewCountdown(by: Date, now: Date = new Date()): string {
  const days = Math.round((by.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 0) return `in ${days} days`;
  if (days === -1) return "yesterday";
  return `${Math.abs(days)} days ago`;
}
