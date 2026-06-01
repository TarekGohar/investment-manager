import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { AnnualReviewClient } from "@/components/annual-review-client";
import { auth } from "@/lib/auth";
import { getLatestAnnualReview } from "@/lib/ai/annual-review";

export default async function AnnualReviewPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const latest = await getLatestAnnualReview(session.user.id);
  const defaultYear = new Date().getUTCFullYear() - 1;

  return (
    <>
      <Topbar title="Annual review" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <h1 className="text-[22px] font-semibold">Annual review</h1>
            <p className="mt-1 text-sm text-muted">
              Once-a-year roll-up. Re-validates every active thesis against
              what actually happened, checks IPS drift, summarises realized
              P&amp;L and dividends, surfaces still-open TLH opportunities, and
              proposes a small list of behavioral commitments for next year.
              Costs one LLM call. Run it after the year closes; re-run as
              needed.
            </p>
          </div>

          <AnnualReviewClient defaultYear={defaultYear} initialReview={latest} />
        </div>
      </div>
    </>
  );
}
