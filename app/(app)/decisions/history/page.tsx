import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { auth } from "@/lib/auth";
import { listClosedDecisions } from "@/lib/alerts/hub";
import { DecisionCard } from "@/components/decision-card";

export default async function DecisionHistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const closed = await listClosedDecisions({ userId: session.user.id, limit: 200 });

  return (
    <>
      <Topbar title="Decision history" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <Link href="/decisions" className="mb-4 inline-block text-xs text-muted hover:text-text">
          ← Back to inbox
        </Link>

        {closed.length === 0 ? (
          <div className="rounded-card border border-border bg-panel p-8 text-center text-sm text-muted">
            No closed decisions yet.
          </div>
        ) : (
          <div className="space-y-2">
            {closed.map((ev) => (
              <DecisionCard key={ev.id} event={ev} closed />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
