import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { SignOutButton } from "@/components/sign-out-button";
import { BrokeragesSection } from "@/components/brokerages-section";
import { EmailTestButton } from "@/components/email-test-button";
import { PreferencesSection } from "@/components/preferences-section";
import { TaxProfileSection } from "@/components/tax-profile-section";
import { PerformanceProfileSection } from "@/components/performance-profile-section";
import { ContributionRoomSection } from "@/components/contribution-room-section";
import { listContributionRooms } from "@/lib/canadian/contribution-room";
import { Tabs, type Tab } from "@/components/tabs";
import { Term } from "@/components/term";
import { UsageFeed } from "@/components/usage-feed";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThemeFromCookie } from "@/lib/theme";
import { getModel, getProviderName } from "@/lib/ai";
import { getMonthlyTokenUsage, listRecentAiEvents } from "@/lib/ai/queries";
import { emailStatus } from "@/lib/email";
import { getUserPreferences } from "@/lib/preferences";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI (cloud)",
  "azure-openai": "Azure OpenAI",
  anthropic: "Anthropic Claude",
};

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [brokerages, theme, preferences, contributionRooms, monthlyUsage, recentEvents] =
    await Promise.all([
      prisma.brokerage.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { transactions: true } } },
      }),
      getThemeFromCookie(),
      getUserPreferences(session.user.id),
      listContributionRooms(session.user.id),
      getMonthlyTokenUsage(session.user.id),
      listRecentAiEvents(session.user.id, 50),
    ]);

  const currentYear = new Date().getUTCFullYear();

  const provider = getProviderName();
  const model = getModel();
  const mg = emailStatus();

  const accountTab = (
    <>
      <Section
        title="Account"
        description="The email you sign in with via magic link."
      >
        <Row label="Email">
          <span className="font-mono text-[14px]">{session.user.email}</span>
        </Row>
        {session.user.name ? <Row label="Name">{session.user.name}</Row> : null}
        <Row label="Member since">
          {new Date(session.user.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </Row>
      </Section>

      <Section title="Session">
        <div className="flex justify-end">
          <SignOutButton />
        </div>
      </Section>
    </>
  );

  const brokeragesTab = (
    <>
      <Section
        title="Brokerages"
        description="Transactions are bucketed by brokerage. A default account is auto-created on your first trade. Add more for separate taxable / registered accounts."
      >
        <BrokeragesSection
          brokerages={brokerages.map((b) => ({
            id: b.id,
            name: b.name,
            kind: b.kind,
            currency: b.currency,
            createdAt: b.createdAt,
            transactionCount: b._count.transactions,
          }))}
        />
      </Section>

      <Section
        title="Import transactions"
        description="Bulk-load an RBC Direct Investing Activity CSV. The importer classifies each row, flags possible duplicates, and auto-fetches CAD-equivalent FX rates."
      >
        <Link
          href="/settings/import"
          className="inline-flex items-center gap-2 rounded-full bg-pill px-4 py-2 text-[13px] font-semibold text-text transition-colors hover:bg-pill/70"
        >
          Open the importer →
        </Link>
      </Section>
    </>
  );

  const preferencesTab = (
    <Section
      title="Preferences"
      description="Toggle AI background jobs, notifications, and per-page fetches. Saved per user."
    >
      <PreferencesSection initial={preferences} />
    </Section>
  );

  const taxTab = (
    <>
      <Section
        title="Tax profile"
        description={<>Your combined federal + provincial <Term term="Marginal rate">marginal rates</Term>. Used for <Term>TLH</Term> dollar sizing, after-tax dividend math, and withdrawal analysis. Blank fields stay blank — no defaults assumed.</>}
      >
        <TaxProfileSection initial={preferences.taxProfile} />
      </Section>

      <Section
        title="Contribution room"
        description={<><Term>TFSA</Term> / <Term>RRSP</Term> / <Term>FHSA</Term> / RESP room you&apos;ve entered from your CRA Notice of Assessment. Used by the transaction form and /tax page to warn about over-contributions.</>}
      >
        <ContributionRoomSection
          entries={contributionRooms}
          currentYear={currentYear}
        />
      </Section>
    </>
  );

  const performanceTab = (
    <Section
      title="Performance profile"
      description={<>Benchmark ticker + <Term term="Risk-free rate">risk-free rate</Term> for <Term>TWR</Term>-vs-benchmark, <Term>beta</Term>, and <Term>Sharpe</Term>. Pick what you actually want to compare against — nothing is assumed.</>}
    >
      <PerformanceProfileSection initial={preferences.performanceProfile} />
    </Section>
  );

  const systemTab = (
    <>
      <Section
        title="Appearance"
        description="Theme syncs across this device via cookie."
      >
        <Row label="Current theme">
          <span className="capitalize">{theme}</span>
          <span className="ml-2 text-xs text-muted-2">
            Use the {theme === "dark" ? "sun" : "moon"} icon in the topbar to switch.
          </span>
        </Row>
      </Section>

      <Section
        title="AI assistant"
        description="Switch providers by editing AI_PROVIDER in .env.local."
      >
        <Row label="Provider">{PROVIDER_LABEL[provider] ?? provider}</Row>
        <Row label={provider === "azure-openai" ? "Deployment" : "Model"}>
          <span className="font-mono text-[14px]">{model}</span>
        </Row>
        <p className="mt-3 text-xs text-muted-2">
          The PM can call: live quotes, news, fundamentals, your portfolio, position detail,
          transaction history.
        </p>
      </Section>

      <Section
        title="Email"
        description="Resend powers magic-link sign-in and alert digests. Without RESEND_API_KEY, the app prints emails to the dev console instead."
      >
        <Row label="Status">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${
              mg.configured
                ? "bg-success/15 text-success"
                : "bg-muted/15 text-muted"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                mg.configured ? "bg-success" : "bg-muted-2"
              }`}
            />
            {mg.configured ? "Resend configured" : "Console fallback"}
          </span>
        </Row>
        {mg.from ? (
          <Row label="From">
            <span className="font-mono text-[14px]">{mg.from}</span>
          </Row>
        ) : null}
        <div className="mt-3 flex justify-end">
          <EmailTestButton configured={mg.configured} />
        </div>
      </Section>

      <Section
        title="Background jobs"
        description="Event-driven cadence for a buy-and-hold portfolio: one consolidated pass at market close, weekly deep cadence on Sunday. Daily review is on-demand, not scheduled."
      >
        <Row label="Refresh quotes">21:00 UTC, Mon–Fri (US market close)</Row>
        <Row label="Classify news (AI)">21:05 UTC, Mon–Fri</Row>
        <Row label="Run alerts">21:10 UTC, Mon–Fri</Row>
        <Row label="End-of-day snapshot">21:30 UTC, Mon–Fri</Row>
        <Row label="Pull filings (EDGAR / SEDAR+)">05:30 UTC, daily</Row>
        <Row label="Weekly PM review">13:00 UTC, Sunday</Row>
        <Row label="Daily PM review">On-demand (dashboard button)</Row>
        <p className="mt-3 text-xs text-muted-2">
          The daily review used to be a fixed cron at 21:15 UTC weekdays — but on an
          unchanged buy-and-hold portfolio it produced near-identical output day after day.
          Pull one when you actually want a snapshot. Local dev never runs crons; use the
          manual triggers on /decisions and the dashboard.
        </p>
      </Section>

      <Section
        title="Data sources"
        description="Where market data comes from."
      >
        <Row label="Quotes / news / fundamentals">Finnhub (15-min delayed)</Row>
        <Row label="Historical candles">Yahoo Finance</Row>
        <Row label="Database">Supabase Postgres (ca-central-1)</Row>
      </Section>
    </>
  );

  const usageTab = (
    <>
      <Section
        title="This month"
        description="Aggregate spend across every AI surface — chat, daily / weekly reviews, quarterly filing reads, news classification, thesis checks. Computed from token counts × per-model pricing; cross-check against the Anthropic console."
      >
        <Row label="Total spend">
          <span className="font-semibold tabular-nums">
            {monthlyUsage.costUsd.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 2,
            })}
          </span>
        </Row>
        <Row label="Total tokens">
          <span className="tabular-nums">{monthlyUsage.totalTokens.toLocaleString()}</span>
        </Row>
        {monthlyUsage.byFamily.length > 0 ? (
          <Row label="By model family">
            <div className="flex flex-col items-end gap-1">
              {monthlyUsage.byFamily.map((row) => (
                <div
                  key={row.family}
                  className="flex items-baseline gap-3 text-[13px]"
                >
                  <span className="text-muted">{row.family}</span>
                  <span className="tabular-nums">
                    {row.costUsd.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 4,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </Row>
        ) : null}
      </Section>

      <Section
        title="Recent activity"
        description="Every AI call that actually drew tokens, newest first. Daily reviews that ended with NO_REVIEW_NEEDED don't show up — by design."
      >
        <UsageFeed events={recentEvents} />
      </Section>
    </>
  );

  const tabs: Tab[] = [
    { key: "Account", content: accountTab },
    { key: "Brokerages", content: brokeragesTab },
    { key: "Preferences", content: preferencesTab },
    { key: "Tax", content: taxTab },
    { key: "Performance", content: performanceTab },
    { key: "Usage", content: usageTab },
    { key: "System", content: systemTab },
  ];

  return (
    <>
      <Topbar title="Settings" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mx-auto max-w-3xl">
          <Tabs tabs={tabs} />
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-[26px] rounded-card border border-border bg-panel px-6 py-[22px]">
      <div className="mb-4">
        <h3 className="text-[16px] font-semibold">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm text-muted">{description}</p>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className="text-right text-[14px] text-text">{children}</div>
    </div>
  );
}
