import { AnnualReviewClient } from "@/components/annual-review-client";
import { getLatestAnnualReview } from "@/lib/ai/annual-review";

export async function AnnualReviewSection({ userId }: { userId: string }) {
  const latest = await getLatestAnnualReview(userId);
  const defaultYear = new Date().getUTCFullYear() - 1;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="text-sm text-muted">
          Once-a-year roll-up. Re-validates every active thesis against what actually happened,
          checks IPS drift, summarises realized P&amp;L and dividends, surfaces still-open TLH
          opportunities, and proposes a small list of behavioral commitments for next year. Costs
          one LLM call. Run it after the year closes; re-run as needed.
        </p>
      </div>

      <AnnualReviewClient defaultYear={defaultYear} initialReview={latest} />
    </div>
  );
}
