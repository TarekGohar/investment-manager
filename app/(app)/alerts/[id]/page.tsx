import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { auth } from "@/lib/auth";
import { getDecisionCard } from "@/lib/alerts/hub";
import { getDecisionHistoryForTicker } from "@/lib/alerts/retrospective";
import { RULE_LABEL } from "@/lib/signals/types";
import { DecisionOutcomeForm } from "@/components/decision-outcome-form";
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

  return (
    <>
      <Topbar title={action ? "Decision detail" : "Notification detail"} />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <Link href="/alerts" className="mb-4 inline-block text-xs text-muted hover:text-text">
          ← Back to inbox
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <article className="space-y-6">
            <header className="rounded-card border border-border bg-panel p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {event.ticker ? (
                  <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 font-mono font-semibold">
                    {event.ticker}
                  </span>
                ) : (
                  <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 font-semibold text-muted">
                    Portfolio
                  </span>
                )}
                {action && (
                  <span className="rounded-[6px] border border-border px-2 py-0.5 font-semibold">
                    {ACTION_LABEL[action]}
                  </span>
                )}
                <span className="rounded-[6px] bg-bg/40 px-2 py-0.5">{event.urgency}</span>
                {action && (
                  <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 text-muted">
                    {OUTCOME_LABEL[event.outcome]}
                  </span>
                )}
                {!action && (
                  <span className="rounded-[6px] bg-bg/40 px-2 py-0.5 text-muted">
                    Notification
                  </span>
                )}
                <span className="ml-auto text-muted">
                  {event.firedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
              </div>
              <p className="mt-3 text-sm text-text">{event.message}</p>
              <SourceLine event={event} />
            </header>

            {event.rationale && (
              <Section title="Rationale">
                <p className="text-sm">{event.rationale}</p>
              </Section>
            )}

            {event.actionDetails && (
              <Section title="Recommended action">
                <ActionDetailsTable details={event.actionDetails as Record<string, unknown>} />
              </Section>
            )}

            {event.sizingRationale && (
              <Section title="Sizing rationale">
                <p className="text-sm">{event.sizingRationale}</p>
                {event.sizingDetails && (
                  <div className="mt-3">
                    <EvidenceTable data={event.sizingDetails as Record<string, unknown>} />
                  </div>
                )}
              </Section>
            )}

            {event.alternativesConsidered && (
              <Section title="Alternatives considered">
                <p className="text-sm">{event.alternativesConsidered}</p>
              </Section>
            )}

            {event.invalidationTrigger && (
              <Section title="What would make this wrong">
                <p className="text-sm">{event.invalidationTrigger}</p>
              </Section>
            )}

            {(event.reviewEvent || event.reviewByDate) && (
              <Section title="Review trigger">
                {event.reviewEvent && <p className="text-sm">{event.reviewEvent}</p>}
                {event.reviewByDate && (
                  <p className="mt-1 text-xs text-muted">
                    By {event.reviewByDate.toISOString().slice(0, 10)}
                  </p>
                )}
              </Section>
            )}

            {event.supportingEvidence && (
              <Section title="Supporting evidence (frozen at firing time)">
                <EvidenceTable data={event.supportingEvidence as Record<string, unknown>} />
              </Section>
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
              <section className="rounded-card border border-border bg-panel p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Prior decisions on {event.ticker}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {priorOnTicker.map((r) => (
                    <li key={r.eventId} className="text-xs">
                      <Link
                        href={`/alerts/${r.eventId}`}
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
              </section>
            )}
            {action ? (
              event.outcome === "OPEN" ? (
                <DecisionOutcomeForm eventId={event.id} />
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
  const sourceText = SOURCE_DESCRIPTION[event.source];
  const ruleText = RULE_LABEL[event.alert.rule];
  return (
    <p className="mt-3 text-xs text-muted">
      {sourceText} · rule {ruleText}
      {event.conversation && (
        <>
          {" · "}
          <Link
            href={`/chat?conversation=${event.conversation.id}`}
            className="text-brand-2 hover:underline"
          >
            View originating chat
          </Link>
        </>
      )}
    </p>
  );
}

const SOURCE_DESCRIPTION: Record<AlertSource, string> = {
  CRON_RULE: "Raised by a scheduled rule",
  AI_CHAT: "Raised by the AI chat",
  DAILY_REVIEW: "Raised by the daily review",
  WEEKLY_REVIEW: "Raised by the weekly review",
  ANNUAL_REVIEW: "Raised by the annual review",
  MANUAL: "Raised manually",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-panel p-5">
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </section>
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
          <dt className="text-muted">{k}</dt>
          <dd className="tabular-nums">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "boolean") return v ? "yes" : "no";
  return JSON.stringify(v);
}
