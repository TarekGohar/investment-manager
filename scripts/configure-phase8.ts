/**
 * Phase 8 — theses for the 10 active growth/income positions.
 *
 * Drafted from publicly-available context as a starting point. User should
 * edit any that don't match his actual reasoning on the position page.
 * The speculative trio (CAT, BNKK, MVMD.CN) intentionally has no thesis —
 * they're winding down per the IPS "Other / Experimental" 0% target.
 *
 * Invalidation criteria are written specifically so Session 5's LLM
 * thesis-check can match them against a filing summary's content.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

type Draft = {
  ticker: string;
  body: string;
  invalidation: string;
  horizonMonths: number | null;
};

const THESES: Draft[] = [
  {
    ticker: "AAPL",
    body:
      "Wide-moat consumer hardware franchise with a high-margin services flywheel (App Store, iCloud, Apple Pay, ads). Installed base of 2B+ devices acts as a recurring-revenue platform. Capital return discipline is exceptional. Held more for stability than upside — won't compound at 30%/yr but unlikely to halve.",
    invalidation:
      "(a) Services revenue growth drops below 5% YoY for two consecutive quarters; OR (b) Operating margin drops below 25% (currently ~30%) for two consecutive quarters; OR (c) Active installed base shrinks YoY (signals hardware franchise erosion).",
    horizonMonths: 60,
  },
  {
    ticker: "MSFT",
    body:
      "Best-positioned AI platform via Azure + OpenAI + Copilot pricing. Enterprise software lock-in (Office, Teams, Windows, Dynamics) provides a high-margin floor independent of the AI bet. Capital allocation has been disciplined for a decade.",
    invalidation:
      "(a) Azure revenue growth drops below 25% YoY for two consecutive quarters; OR (b) AI capex grows faster than AI revenue for four consecutive quarters (signals the AI bet isn't paying); OR (c) Operating margin drops below 40% for two consecutive quarters.",
    horizonMonths: 60,
  },
  {
    ticker: "AVGO",
    body:
      "Quasi-monopoly on custom AI silicon for hyperscalers (Google TPU, Meta MTIA) and on networking ASICs. AI segment is the growth engine; VMware acquisition added a recurring software revenue base. Strong cash conversion + shareholder return.",
    invalidation:
      "(a) AI segment revenue growth drops below 30% YoY for two consecutive quarters; OR (b) VMware ARR shrinks YoY (signals integration is failing); OR (c) Free cash flow conversion drops below 80% of GAAP net income.",
    horizonMonths: 36,
  },
  {
    ticker: "AMZN",
    body:
      "AWS is the cloud margin leader; advertising scaled to ~$50B/yr at high margins; retail is a low-margin distribution moat. AI workloads should accelerate AWS growth from here. Free cash flow finally tracks reported earnings.",
    invalidation:
      "(a) AWS revenue growth drops below 15% YoY for two consecutive quarters; OR (b) Operating margin drops below 8% (currently ~10%) for two consecutive quarters; OR (c) Free cash flow turns negative on a trailing-twelve-month basis.",
    horizonMonths: 60,
  },
  {
    ticker: "PLTR",
    body:
      "Best government data platform (Foundry/Apollo deployed in defence, intel, health), pivoting to enterprise with AIP. Government revenue is sticky; commercial is the growth engine. Premium valuation justified only if commercial revenue compounds 30%+.",
    invalidation:
      "(a) US commercial revenue growth drops below 30% YoY for two consecutive quarters; OR (b) Government segment revenue contracts YoY (signals install-base risk); OR (c) Stock-based compensation exceeds 25% of revenue (dilution risk; currently ~20%).",
    horizonMonths: 24,
  },
  {
    ticker: "NFLX",
    body:
      "Streaming has clear pricing power (multiple rate hikes accepted), ad tier scaling, password-sharing crackdown added millions of subs. Profitable at scale where most streamers are not. Original-content engine still produces hits.",
    invalidation:
      "(a) Net subscriber adds turn negative for two consecutive quarters; OR (b) Operating margin drops below 20% (currently ~25%) for two consecutive quarters; OR (c) Free cash flow drops below $5B annualized (currently ~$6–7B).",
    horizonMonths: 36,
  },
  {
    ticker: "NET",
    body:
      "Edge compute + security infrastructure that large enterprises buy as the 'AWS for the network edge'. Workers / R2 / D1 stack competes credibly with AWS Lambda + S3. Long runway in DDoS / zero-trust if execution holds. GAAP-unprofitable today — bull case requires margin expansion.",
    invalidation:
      "(a) Net dollar retention drops below 110% (currently ~115%) for two consecutive quarters; OR (b) Large-customer growth (>$100k ARR) drops below 20% YoY; OR (c) GAAP operating margin remains negative at end of FY (no path to profitability).",
    horizonMonths: 36,
  },
  {
    ticker: "DT",
    body:
      "Application performance / observability platform with strong enterprise penetration. Observability category benefits from AI-driven complexity in customer stacks. Recurring SaaS revenue base; profitable today.",
    invalidation:
      "(a) ARR growth drops below 18% YoY for two consecutive quarters; OR (b) Net retention drops below 110%; OR (c) Operating margin compresses below 20% (currently ~22%).",
    horizonMonths: 24,
  },
  {
    ticker: "CRSP",
    body:
      "First-mover CRISPR-Cas9 therapy approved (Casgevy for sickle cell, beta thalassemia). Pipeline expanding into in vivo therapies which would dramatically expand TAM if successful. Speculative — small position size reflects that. Expect 50%+ drawdown years.",
    invalidation:
      "(a) Casgevy commercial uptake disappoints (less than $200M cumulative revenue by year 2 post-launch); OR (b) A pipeline trial reads out poorly (esp. CTX112 or in-vivo programs); OR (c) Cash burn outruns capital availability (forces dilutive equity raise).",
    horizonMonths: 60,
  },
  {
    ticker: "RY",
    body:
      "Largest Canadian bank by market cap. Dominant in Canadian retail banking + wealth management; HSBC Canada acquisition added scale. Reliable dividend + buybacks. Held as the Canadian Equity anchor in the portfolio — 'forever hold' name.",
    invalidation:
      "(a) Dividend cut (extremely rare for Canadian Big 6 — only happened during 2008 GFC and only for some banks); OR (b) Common Equity Tier 1 ratio drops below 11% (regulatory minimum is 11.5% — would signal stress); OR (c) Canadian residential real estate exposure forces a loss provision exceeding $2B in a single quarter.",
    horizonMonths: 120,
  },
];

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "tarekgohar@outlook.com" },
    select: { id: true },
  });

  for (const d of THESES) {
    await prisma.thesis.upsert({
      where: { userId_ticker: { userId: user.id, ticker: d.ticker } },
      update: {
        body: d.body,
        invalidationCriteria: d.invalidation,
        horizonMonths: d.horizonMonths,
        status: "ACTIVE",
      },
      create: {
        userId: user.id,
        ticker: d.ticker,
        body: d.body,
        invalidationCriteria: d.invalidation,
        horizonMonths: d.horizonMonths,
        status: "ACTIVE",
      },
    });
    console.log(`  ✓ ${d.ticker.padEnd(6)} — ${d.body.slice(0, 70).replace(/\n/g, " ")}...`);
  }
  console.log(`\nSaved ${THESES.length} theses.`);
  await prisma.$disconnect();
})();
