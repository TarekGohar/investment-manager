import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Tabs, type Tab } from "@/components/tabs";
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

// "Material" is the implicit default — most decisions are MATERIAL, so the
// section header reads better without the word repeated. URGENT and INFO are
// the ones that actually carry signal.
const URGENCY_LABEL: Record<DecisionUrgency, string> = {
  URGENT: "Urgent",
  MATERIAL: "Decisions",
  INFO: "Lower priority",
};

export default async function DecisionsPage() {
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

  const urgentCount = grouped.get("URGENT")?.length ?? 0;
  const nothingActive = open.length === 0;

  const actOnTab = (
    <>
      {urgentCount > 0 ? (
        <div className="mb-6 rounded-card border border-danger/40 bg-danger/10 px-5 py-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-danger">
            {urgentCount} urgent {urgentCount === 1 ? "decision" : "decisions"}
          </div>
          <div className="mt-1 text-sm text-text">
            Review these first — they have the tightest action window.
          </div>
        </div>
      ) : null}

      {nothingActive ? (
        <EmptyInbox />
      ) : (
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
    </>
  );

  const notificationsTab =
    notifications.length === 0 ? (
      <div className="rounded-card border border-border bg-panel p-8 text-center">
        <p className="text-sm font-semibold">No notifications.</p>
        <p className="mt-2 text-xs text-muted">
          Info-only events from cron rules show up here. Nothing requires action.
        </p>
      </div>
    ) : (
      <div>
        <p className="mb-3 text-xs text-muted-2">
          Info-only events from cron rules. No action implied — these are FYI. If you want to act,
          raise a manual decision from the position page.
        </p>
        <div className="space-y-2">
          {notifications.map((ev) => (
            <NotificationCard key={ev.id} event={ev} />
          ))}
        </div>
      </div>
    );

  const closedTab =
    recentClosed.length === 0 ? (
      <div className="rounded-card border border-border bg-panel p-8 text-center">
        <p className="text-sm font-semibold">No closed decisions yet.</p>
        <p className="mt-2 text-xs text-muted">
          Once you act on or dismiss a decision, it lands here.
        </p>
      </div>
    ) : (
      <div>
        <div className="mb-3 flex items-center justify-end">
          <Link href="/decisions/history" className="text-xs text-brand-2 hover:underline">
            Full history →
          </Link>
        </div>
        <div className="space-y-2">
          {recentClosed.map((ev) => (
            <DecisionCard key={ev.id} event={ev} closed />
          ))}
        </div>
      </div>
    );

  const tabs: Tab[] = [
    { key: `To act on${open.length > 0 ? ` (${open.length})` : ""}`, content: actOnTab },
    {
      key: `Notifications${notifications.length > 0 ? ` (${notifications.length})` : ""}`,
      content: notificationsTab,
    },
    { key: "Closed", content: closedTab },
  ];

  return (
    <>
      <Topbar title="Decisions" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <div className="max-w-2xl text-sm text-muted-2">
            Everything the platform thinks deserves a moment of attention. Decisions get a
            recommended action; notifications are FYI.
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href="/decisions/rules" className="text-brand-2 hover:underline">
              Rules →
            </Link>
            <Link href="/decisions/retrospective" className="text-brand-2 hover:underline">
              Retrospective →
            </Link>
          </div>
        </div>

        <Tabs tabs={tabs} />
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
