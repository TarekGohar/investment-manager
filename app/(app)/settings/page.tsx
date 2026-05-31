import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { SignOutButton } from "@/components/sign-out-button";
import { BrokeragesSection } from "@/components/brokerages-section";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThemeFromCookie } from "@/lib/theme";
import { getModel, getProviderName } from "@/lib/ai";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI (cloud)",
  "azure-openai": "Azure OpenAI",
  anthropic: "Anthropic Claude",
};

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [brokerages, theme] = await Promise.all([
    prisma.brokerage.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { transactions: true } } },
    }),
    getThemeFromCookie(),
  ]);

  const provider = getProviderName();
  const model = getModel();

  return (
    <>
      <Topbar title="Settings" />
      <div className="px-4 pb-12 pt-6 md:px-6 lg:px-[34px] lg:pt-[30px] lg:pb-[60px]">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Account */}
          <Section title="Account" description="The email you sign in with via magic link.">
            <Row label="Email">
              <span className="font-mono text-[14px]">{session.user.email}</span>
            </Row>
            {session.user.name ? (
              <Row label="Name">{session.user.name}</Row>
            ) : null}
            <Row label="Member since">
              {new Date(session.user.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Row>
          </Section>

          {/* Brokerages */}
          <Section
            title="Brokerages"
            description="Your transactions are bucketed by brokerage. A default account is auto-created on your first trade. Add more for separate taxable / registered accounts."
          >
            <BrokeragesSection
              brokerages={brokerages.map((b) => ({
                id: b.id,
                name: b.name,
                currency: b.currency,
                createdAt: b.createdAt,
                transactionCount: b._count.transactions,
              }))}
            />
          </Section>

          {/* Appearance */}
          <Section title="Appearance" description="Theme syncs across this device via cookie.">
            <Row label="Current theme">
              <span className="capitalize">{theme}</span>
              <span className="ml-2 text-xs text-muted-2">
                Use the {theme === "dark" ? "sun" : "moon"} icon in the topbar to switch.
              </span>
            </Row>
          </Section>

          {/* AI */}
          <Section
            title="AI assistant"
            description="Switch providers by editing AI_PROVIDER in .env.local (and the relevant key)."
          >
            <Row label="Provider">{PROVIDER_LABEL[provider] ?? provider}</Row>
            <Row label={provider === "azure-openai" ? "Deployment" : "Model"}>
              <span className="font-mono text-[14px]">{model}</span>
            </Row>
            <p className="mt-2 text-xs text-muted-2">
              Tools the PM can call: live quotes, news, fundamentals, your portfolio, position
              detail, transaction history.
            </p>
          </Section>

          {/* Data sources */}
          <Section title="Data sources" description="Where market data comes from.">
            <Row label="Quotes / news / fundamentals">Finnhub (15-min delayed)</Row>
            <Row label="Historical candles">Yahoo Finance</Row>
            <Row label="Database">Supabase Postgres (ca-central-1)</Row>
          </Section>

          {/* Session */}
          <Section title="Session" description="">
            <SignOutButton />
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
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-panel px-6 py-5">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      {description ? (
        <p className="mb-4 mt-1 text-sm text-muted">{description}</p>
      ) : (
        <div className="mb-4" />
      )}
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className="text-right text-[14px] text-text">{children}</div>
    </div>
  );
}
