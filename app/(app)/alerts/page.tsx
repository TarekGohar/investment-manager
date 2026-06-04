import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { auth } from "@/lib/auth";
import {
  listOpenDecisions,
  listClosedDecisions,
  listRecentNotifications,
} from "@/lib/alerts/hub";
import { DecisionCard } from "@/components/decision-card";
import { NotificationCard } from "@/components/notification-card";
import type { DecisionUrgency } from "@/generated/prisma";

const URGENCY_ORDER: DecisionUrgency[] = ["URGENT", "MATERIAL", "INFO"];

const URGENCY_LABEL: Record<DecisionUrgency, string> = {
  URGENT: "Urgent",
  MATERIAL: "Material",
  INFO: "Informational",
};

export default async function AlertsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [open, recentClosed, notifications] = await Promise.all([
    listOpenDecisions({ userId: session.user.id, limit: 100 }),
    listClosedDecisions({ userId: session.user.id, limit: 10 }),
    listRecentNotifications({ userId: session.user.id, limit: 25 }),
  ]);

  const grouped = new Map<DecisionUrgency, typeof open>();
  for (const u of URGENCY_ORDER) grouped.set(u, []);
  for (const ev of open) {
    grouped.get(ev.urgency)?.push(ev);
  }

  const nothingActive = open.length === 0 && notifications.length === 0;

  return (
    <>
      <Topbar title="Alerts" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <div className="max-w-2xl text-sm text-muted-2">
            Every signal across the platform lands here. Items the system thinks you should act on
            get a recommended action; the rest are notifications you can read and dismiss.
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href="/alerts/rules" className="text-brand-2 hover:underline">
              Rules →
            </Link>
            <Link href="/alerts/retrospective" className="text-brand-2 hover:underline">
              Retrospective →
            </Link>
          </div>
        </div>

        {nothingActive ? (
          <EmptyInbox />
        ) : (
          <div className="space-y-8">
            {open.length > 0 && (
              <div className="space-y-8">
                {URGENCY_ORDER.map((urgency) => {
                  const items = grouped.get(urgency) ?? [];
                  if (items.length === 0) return null;
                  return (
                    <section key={urgency}>
                      <h2 className="mb-3 text-[14px] font-semibold uppercase tracking-wide text-muted">
                        {URGENCY_LABEL[urgency]} · {items.length}
                      </h2>
                      <div className="space-y-2">
                        {items.map((ev) => (
                          <DecisionCard key={ev.id} event={ev} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}

            {notifications.length > 0 && (
              <section>
                <h2 className="mb-3 text-[14px] font-semibold uppercase tracking-wide text-muted">
                  Notifications · {notifications.length}
                </h2>
                <p className="mb-3 text-xs text-muted-2">
                  Info-only events from cron rules. No action implied — these are FYI. If you want
                  to act, raise a manual decision from the position page.
                </p>
                <div className="space-y-2">
                  {notifications.map((ev) => (
                    <NotificationCard key={ev.id} event={ev} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {recentClosed.length > 0 && (
          <section className="mt-12 border-t border-border pt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold uppercase tracking-wide text-muted">
                Recently closed · {recentClosed.length}
              </h2>
              <Link href="/alerts/history" className="text-xs text-brand-2 hover:underline">
                Full history →
              </Link>
            </div>
            <div className="space-y-2">
              {recentClosed.map((ev) => (
                <DecisionCard key={ev.id} event={ev} closed />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function EmptyInbox() {
  return (
    <div className="rounded-card border border-border bg-panel p-8 text-center">
      <p className="text-sm font-semibold">Nothing needs your attention right now.</p>
      <p className="mt-2 text-xs text-muted">
        The platform stays quiet when there&apos;s nothing to flag. New decisions and notifications
        land here from chat, reviews, cron rules, and manual flags.
      </p>
    </div>
  );
}
