import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { SignOutButton } from "@/components/sign-out-button";
import { BrokeragesSection } from "@/components/brokerages-section";
import { MailgunTestButton } from "@/components/mailgun-test-button";
import { PreferencesSection } from "@/components/preferences-section";
import { TaxProfileSection } from "@/components/tax-profile-section";
import { PerformanceProfileSection } from "@/components/performance-profile-section";
import { ContributionRoomSection } from "@/components/contribution-room-section";
import { listContributionRooms } from "@/lib/canadian/contribution-room";
import { ChevronDownIcon } from "@/components/icons";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThemeFromCookie } from "@/lib/theme";
import { getModel, getProviderName } from "@/lib/ai";
import { mailgunStatus } from "@/lib/mailgun";
import { getUserPreferences } from "@/lib/preferences";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI (cloud)",
  "azure-openai": "Azure OpenAI",
  anthropic: "Anthropic Claude",
};

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [brokerages, theme, preferences, contributionRooms] = await Promise.all([
    prisma.brokerage.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { transactions: true } } },
    }),
    getThemeFromCookie(),
    getUserPreferences(session.user.id),
    listContributionRooms(session.user.id),
  ]);

  const currentYear = new Date().getUTCFullYear();

  const provider = getProviderName();
  const model = getModel();
  const mg = mailgunStatus();

  return (
    <>
      <Topbar title="Settings" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mx-auto max-w-3xl space-y-3">
          <Section
            title="Account"
            description="The email you sign in with via magic link."
            defaultOpen
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

          <Section
            title="Brokerages"
            description="Transactions are bucketed by brokerage. A default account is auto-created on your first trade. Add more for separate taxable / registered accounts."
            defaultOpen
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
            defaultOpen
          >
            <Link
              href="/settings/import"
              className="inline-flex items-center gap-2 rounded-full bg-pill px-4 py-2 text-[13px] font-semibold text-text transition-colors hover:bg-pill/70"
            >
              Open the importer →
            </Link>
          </Section>

          <Section
            title="Preferences"
            description="Toggle AI background jobs, notifications, and per-page fetches. Saved per user."
            defaultOpen
          >
            <PreferencesSection initial={preferences} />
          </Section>

          <Section
            title="Tax profile"
            description="Your combined federal + provincial marginal rates. Used for TLH dollar sizing, after-tax dividend math, and withdrawal analysis. Blank fields stay blank — no defaults assumed."
            defaultOpen
          >
            <TaxProfileSection initial={preferences.taxProfile} />
          </Section>

          <Section
            title="Performance profile"
            description="Benchmark ticker + risk-free rate for TWR-vs-benchmark, beta, and Sharpe. Pick what you actually want to compare against — nothing is assumed."
            defaultOpen
          >
            <PerformanceProfileSection initial={preferences.performanceProfile} />
          </Section>

          <Section
            title="Contribution room"
            description="TFSA / RRSP / FHSA / RESP room you've entered from your CRA Notice of Assessment. Used by the transaction form and /tax page to warn about over-contributions."
            defaultOpen
          >
            <ContributionRoomSection
              entries={contributionRooms}
              currentYear={currentYear}
            />
          </Section>

          <Section
            title="Appearance"
            description="Theme syncs across this device via cookie."
            defaultOpen
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
            defaultOpen
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
            description="Mailgun is used for magic-link sign-in and alert digests. Without it, the app falls back to logging emails in the dev console."
            defaultOpen
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
                {mg.configured ? "Mailgun configured" : "Console fallback"}
              </span>
            </Row>
            {mg.domain ? (
              <Row label="Domain">
                <span className="font-mono text-[14px]">{mg.domain}</span>
              </Row>
            ) : null}
            {mg.from ? (
              <Row label="From">
                <span className="font-mono text-[14px]">{mg.from}</span>
              </Row>
            ) : null}
            <div className="mt-3 flex justify-end">
              <MailgunTestButton configured={mg.configured} />
            </div>
          </Section>

          <Section
            title="Background jobs"
            description="Event-driven cadence for a buy-and-hold portfolio: one consolidated pass at market close, weekly deep cadence on Sunday. Daily review is on-demand, not scheduled."
            defaultOpen
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
              manual triggers on /alerts and the dashboard.
            </p>
          </Section>

          <Section
            title="Data sources"
            description="Where market data comes from."
            defaultOpen
          >
            <Row label="Quotes / news / fundamentals">Finnhub (15-min delayed)</Row>
            <Row label="Historical candles">Yahoo Finance</Row>
            <Row label="Database">Supabase Postgres (ca-central-1)</Row>
          </Section>

          <Section title="Session" defaultOpen>
            <div className="flex justify-end">
              <SignOutButton />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-card border border-border bg-panel"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-6 py-5 outline-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted">{description}</p>
          ) : null}
        </div>
        <ChevronDownIcon className="h-5 w-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-6 py-5">{children}</div>
    </details>
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
