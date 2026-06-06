import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { getInvestmentPolicy, computeDrift } from "@/lib/policy/ips";
import { listTheses } from "@/lib/policy/thesis";
import { detectBehavioralPatterns } from "@/lib/behavioral/patterns";
import { PolicyEditor } from "@/components/policy-editor";
import { DriftTable } from "@/components/drift-table";
import { BehavioralPatterns } from "@/components/behavioral-patterns";
import { ThesisList } from "@/components/thesis-list";

export async function PolicySection({ userId }: { userId: string }) {
  const [policy, portfolio, theses, behavioral] = await Promise.all([
    getInvestmentPolicy(userId),
    getEnrichedPortfolio(userId),
    listTheses(userId),
    detectBehavioralPatterns(userId),
  ]);

  const drift = computeDrift(portfolio.holdings, policy);

  return (
    <div className="mx-auto max-w-5xl space-y-[26px]">
      <DriftTable drift={drift} thresholdPct={policy.driftThresholdPct} />
      <BehavioralPatterns report={behavioral} />
      <ThesisList theses={theses} />
      <PolicyEditor
        initial={policy}
        tickers={portfolio.holdings.map((h) => h.ticker)}
      />
    </div>
  );
}
