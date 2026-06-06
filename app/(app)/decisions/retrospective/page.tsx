import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { auth } from "@/lib/auth";
import {
  getHitRate,
  getCounterfactualOnAbandoned,
  getExecutionRate,
  getDecisionLag,
  getDriftAttribution,
  getActionPatterns,
} from "@/lib/alerts/retrospective";
import type { AlertSource } from "@/generated/prisma";

const SOURCE_LABEL: Record<AlertSource, string> = {
  CRON_RULE: "Cron rules",
  AI_CHAT: "AI chat",
  DAILY_REVIEW: "Daily review",
  WEEKLY_REVIEW: "Weekly review",
  ANNUAL_REVIEW: "Annual review",
  MANUAL: "Manual flags",
};

const SINCE_MONTHS = 12;
const DRIFT_LOOKBACK_MONTHS = 6;

export default async function RetrospectivePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [hitRate, counterfactual, execRate, lag, drift, patterns] = await Promise.all([
    getHitRate({ userId: session.user.id, sinceMonths: SINCE_MONTHS }),
    getCounterfactualOnAbandoned({ userId: session.user.id, sinceMonths: SINCE_MONTHS }),
    getExecutionRate({ userId: session.user.id, sinceMonths: SINCE_MONTHS }),
    getDecisionLag({ userId: session.user.id }),
    getDriftAttribution({ userId: session.user.id, sinceMonths: DRIFT_LOOKBACK_MONTHS }),
    getActionPatterns({ userId: session.user.id }),
  ]);

  return (
    <>
      <Topbar title="Decision retrospective" />
      <div className="space-y-8 px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <Link href="/decisions" className="inline-block text-xs text-muted hover:text-text">
          ← Back to inbox
        </Link>

        <div className="max-w-2xl text-sm text-muted-2">
          Self-grading on closed decisions from the last {SINCE_MONTHS} months. The point isn&apos;t to
          tell you whether you&apos;re right — it&apos;s to make patterns visible so you can decide
          whether your discipline is helping or hurting.
        </div>

        {/* Tiles */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Total decisions"
            value={String(hitRate.totalDecisions)}
            sub={`${SINCE_MONTHS}-month window`}
          />
          <Tile
            label="Scored decisions"
            value={String(hitRate.scoredDecisions)}
            sub="have at least one horizon elapsed"
          />
          <Tile
            label="Median decision lag"
            value={lag.medianHours != null ? formatHours(lag.medianHours) : "—"}
            sub={lag.count > 0 ? `across ${lag.count} closed` : "no closed yet"}
          />
          <Tile
            label="Abandoned counterfactual"
            value={
              counterfactual.totalDollarImpact == null
                ? "—"
                : `${counterfactual.totalDollarImpact >= 0 ? "+" : "−"}$${Math.abs(counterfactual.totalDollarImpact).toFixed(0)}`
            }
            sub={`${counterfactual.rows.length} abandoned`}
            tone={
              counterfactual.totalDollarImpact == null
                ? "neutral"
                : counterfactual.totalDollarImpact >= 0
                  ? "warning"
                  : "success"
            }
          />
        </section>

        {/* Hit rate */}
        <section className="rounded-card border border-border bg-panel p-5">
          <h2 className="text-[14px] font-semibold uppercase tracking-wide text-muted">
            Hit rate by horizon
          </h2>
          <p className="mt-1 text-xs text-muted-2">
            Did the position move the direction the recommendation implied? ADD/HOLD = price up;
            TRIM/EXIT = price down. Decisions need to age through the horizon before they score.
          </p>
          {hitRate.scoredDecisions === 0 ? (
            <p className="mt-4 text-sm text-muted">
              No scored decisions yet. Close some directional decisions with executed outcomes and
              wait at least 30 days for them to mature.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Horizon</th>
                  <th className="py-2 text-right">Scored</th>
                  <th className="py-2 text-right">Hit rate</th>
                  <th className="py-2 text-right">Avg directional return</th>
                </tr>
              </thead>
              <tbody>
                {hitRate.byHorizon.map((r) => (
                  <tr key={r.horizonDays} className="border-t border-border">
                    <td className="py-2">{r.horizonDays}d</td>
                    <td className="py-2 text-right tabular-nums">{r.totalScored}</td>
                    <td className="py-2 text-right tabular-nums">
                      {r.totalScored > 0 ? `${r.hitRatePct.toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.totalScored > 0 ? `${r.avgReturnPct >= 0 ? "+" : ""}${r.avgReturnPct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Counterfactual on abandoned */}
        <section className="rounded-card border border-border bg-panel p-5">
          <h2 className="text-[14px] font-semibold uppercase tracking-wide text-muted">
            Abandoned counterfactual
          </h2>
          <p className="mt-1 text-sm">{counterfactual.message}</p>
          {counterfactual.rows.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Ticker</th>
                  <th className="py-2">Action</th>
                  <th className="py-2">Raised</th>
                  <th className="py-2 text-right">Directional return</th>
                  <th className="py-2 text-right">Dollar impact</th>
                  <th className="py-2">Your notes</th>
                </tr>
              </thead>
              <tbody>
                {counterfactual.rows.map((r) => (
                  <tr key={r.eventId} className="border-t border-border">
                    <td className="py-2 font-mono">{r.ticker}</td>
                    <td className="py-2">{r.action}</td>
                    <td className="py-2 text-muted">{r.firedAt.toISOString().slice(0, 10)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {`${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(1)}%`}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.estimatedDollarImpact == null
                        ? "—"
                        : `${r.estimatedDollarImpact >= 0 ? "+" : "−"}$${Math.abs(r.estimatedDollarImpact).toFixed(0)}`}
                    </td>
                    <td className="py-2 text-xs italic text-muted">{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Execution rate by source */}
        <section className="rounded-card border border-border bg-panel p-5">
          <h2 className="text-[14px] font-semibold uppercase tracking-wide text-muted">
            Execution rate by source
          </h2>
          <p className="mt-1 text-xs text-muted-2">
            High abandonment from AI chat may mean the persona is too aggressive. High abandonment
            from cron rules may mean rules are too noisy. Both are signal.
          </p>
          {execRate.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No closed decisions in this window.</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Source</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Executed</th>
                  <th className="py-2 text-right">Abandoned</th>
                  <th className="py-2 text-right">Rejected</th>
                  <th className="py-2 text-right">Exec rate</th>
                </tr>
              </thead>
              <tbody>
                {execRate.map((r) => (
                  <tr key={r.source} className="border-t border-border">
                    <td className="py-2">{SOURCE_LABEL[r.source]}</td>
                    <td className="py-2 text-right tabular-nums">{r.total}</td>
                    <td className="py-2 text-right tabular-nums">{r.executed}</td>
                    <td className="py-2 text-right tabular-nums">{r.abandoned}</td>
                    <td className="py-2 text-right tabular-nums">{r.rejected}</td>
                    <td className="py-2 text-right tabular-nums">{r.executionRatePct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Drift attribution */}
        <section className="rounded-card border border-border bg-panel p-5">
          <h2 className="text-[14px] font-semibold uppercase tracking-wide text-muted">
            IPS drift: passive vs active ({DRIFT_LOOKBACK_MONTHS}-month lookback)
          </h2>
          <p className="mt-1 text-xs text-muted-2">
            Passive drift is what the market did to your book. Active drift is what your trades did.
            &quot;Over target because the winners ran&quot; is a trim conversation; &quot;over target
            because I added six times&quot; is a behavioral conversation.
          </p>
          {!drift.available ? (
            <p className="mt-4 text-sm text-muted">
              {drift.reason ?? "Drift attribution not available."}
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Bucket</th>
                  <th className="py-2 text-right">Target</th>
                  <th className="py-2 text-right">Actual</th>
                  <th className="py-2 text-right">Total drift</th>
                  <th className="py-2 text-right">Passive (price)</th>
                  <th className="py-2 text-right">Active (trades)</th>
                </tr>
              </thead>
              <tbody>
                {drift.rows.map((r) => (
                  <tr key={r.category} className="border-t border-border">
                    <td className="py-2">{r.category}</td>
                    <td className="py-2 text-right tabular-nums">{r.targetPct.toFixed(1)}%</td>
                    <td className="py-2 text-right tabular-nums">{r.actualPct.toFixed(1)}%</td>
                    <td className="py-2 text-right tabular-nums">{signPp(r.totalDriftPp)}</td>
                    <td className="py-2 text-right tabular-nums">{signPp(r.passiveDriftPp)}</td>
                    <td className="py-2 text-right tabular-nums">{signPp(r.activeDriftPp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Patterns */}
        {patterns.length > 0 && (
          <section className="rounded-card border border-border bg-panel p-5">
            <h2 className="text-[14px] font-semibold uppercase tracking-wide text-muted">
              Patterns worth a look
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {patterns.map((p, i) => (
                <li
                  key={i}
                  className={`rounded-[8px] border px-3 py-2 ${
                    p.severity === "WATCH"
                      ? "border-warning/40 bg-warning/5"
                      : "border-border"
                  }`}
                >
                  {p.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-text";
  return (
    <div className="rounded-card border border-border bg-panel p-4">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-2">{sub}</div>}
    </div>
  );
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

function signPp(v: number): string {
  if (Math.abs(v) < 0.05) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp`;
}
