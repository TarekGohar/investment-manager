import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { AlertsList } from "@/components/alerts-list";
import { AlertEventsFeed } from "@/components/alert-events-feed";
import { AlertRuleForm } from "@/components/alert-rule-form";
import { auth } from "@/lib/auth";
import {
  listAlertsForUser,
  listRecentEvents,
  markAllEventsRead,
} from "@/lib/signals/queries";
import { getUserTickers } from "@/lib/portfolio/queries";

export default async function AlertsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [alerts, events, tickers] = await Promise.all([
    listAlertsForUser(session.user.id),
    listRecentEvents(session.user.id, 30),
    getUserTickers(session.user.id),
  ]);

  // Snapshot taken — clear unread badge for subsequent navigations
  await markAllEventsRead(session.user.id);

  return (
    <>
      <Topbar title="Alerts" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="flex flex-col gap-[26px] lg:flex-row lg:items-start">
          <section className="min-w-0 flex-1 space-y-[26px]">
            <AlertsList alerts={alerts} />
            <AlertEventsFeed events={events} />
          </section>
          <div className="w-full lg:w-[420px] lg:shrink-0">
            <AlertRuleForm tickerHints={tickers.map((t) => t.ticker)} />
            <p className="mt-3 text-xs text-muted-2">
              Vercel Cron runs the evaluator every 30 minutes. Use{" "}
              <span className="font-mono">Run now</span> above to fire a manual check
              against current data.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
