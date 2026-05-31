import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { auth } from "@/lib/auth";
import { getEnrichedPortfolio } from "@/lib/portfolio/queries";
import { getInvestmentPolicy, computeDrift } from "@/lib/policy/ips";
import { listTheses } from "@/lib/policy/thesis";
import { detectBehavioralPatterns } from "@/lib/behavioral/patterns";
import { PolicyEditor } from "@/components/policy-editor";
import { DriftTable } from "@/components/drift-table";
import { BehavioralPatterns } from "@/components/behavioral-patterns";
import { ThesisList } from "@/components/thesis-list";

export default async function PolicyPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [policy, portfolio, theses, behavioral] = await Promise.all([
    getInvestmentPolicy(session.user.id),
    getEnrichedPortfolio(session.user.id),
    listTheses(session.user.id),
    detectBehavioralPatterns(session.user.id),
  ]);

  const drift = computeDrift(portfolio.holdings, policy);

  return (
    <>
      <Topbar title="Investment policy" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mx-auto max-w-5xl space-y-[26px]">
          <DriftTable drift={drift} thresholdPct={policy.driftThresholdPct} />
          <BehavioralPatterns report={behavioral} />
          <ThesisList theses={theses} />
          <PolicyEditor
            initial={policy}
            tickers={portfolio.holdings.map((h) => h.ticker)}
          />
        </div>
      </div>
    </>
  );
}
