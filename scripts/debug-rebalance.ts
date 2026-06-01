/**
 * Inline replica of runRebalanceWatch so we can see at each gate why
 * the alert isn't firing. Bypasses server-only barrier; reads the same
 * data the real watcher would see.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

async function fetchUsdToCad(): Promise<number> {
  const url = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5`;
  const res = await fetch(url);
  const j = (await res.json()) as { observations?: Array<{ FXUSDCAD?: { v: string } }> };
  for (let i = (j.observations?.length ?? 0) - 1; i >= 0; i--) {
    const v = j.observations![i].FXUSDCAD?.v;
    if (v) return Number(v);
  }
  return 1.38;
}

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "tarekgohar@outlook.com" },
    select: { id: true },
  });

  // Gate 1: policy must be configured
  const policy = await prisma.investmentPolicy.findUnique({
    where: { userId: user.id },
  });
  if (!policy) { console.log("GATE 1 FAIL: no IPS row"); return; }
  const driftThreshold = policy.driftThresholdPct?.toNumber() ?? null;
  console.log(`Gate 1: IPS exists, driftThreshold = ${driftThreshold}`);
  if (driftThreshold == null) { console.log("GATE 1 FAIL: driftThresholdPct null"); return; }

  const targets = policy.targetAllocation as Record<string, number>;
  const tickerCategories = policy.tickerCategories as Record<string, string>;
  console.log(`Gate 2: targets = ${Object.keys(targets).length} categories`);
  if (Object.keys(targets).length === 0) { console.log("GATE 2 FAIL"); return; }

  // Gate 3: must have holdings
  const txs = await prisma.transaction.findMany({
    where: { userId: user.id, ticker: { not: null } },
    include: { brokerage: { select: { kind: true } } },
    orderBy: { occurredAt: "asc" },
  });
  type Pos = { qty: number; costNative: number; ccy: string };
  const positions = new Map<string, Pos>();
  for (const t of txs) {
    const p = positions.get(t.ticker!) ?? { qty: 0, costNative: 0, ccy: t.currency };
    if (t.kind === "BUY" || t.kind === "TRANSFER_IN") {
      p.qty += Number(t.quantity);
      p.costNative += Number(t.quantity) * Number(t.price) + Number(t.fees);
      if (p.ccy === "CAD" && t.currency !== "CAD") p.ccy = t.currency;
    } else if (t.kind === "SELL" || t.kind === "TRANSFER_OUT") {
      if (p.qty > 0) {
        const acb = p.costNative / p.qty;
        const out = Math.min(Number(t.quantity), p.qty);
        p.qty -= out;
        p.costNative -= out * acb;
      }
    }
    positions.set(t.ticker!, p);
  }

  const quotes = await prisma.quote.findMany();
  const qByT = new Map(quotes.map((q) => [q.ticker, Number(q.price)]));
  const fx = await fetchUsdToCad();
  console.log(`USD→CAD: ${fx}`);

  // Compute drift, in CAD-equivalent
  let totalMVCad = 0;
  const byCategory = new Map<string, number>();
  const uncategorized: string[] = [];
  for (const [ticker, p] of positions) {
    if (p.qty <= 0) continue;
    const rawQ = qByT.get(ticker) ?? 0;
    const quoteCcy = /\.(TO|V|NE|CN)$/.test(ticker.toUpperCase()) ? "CAD" : "USD";
    const quoteToPos = quoteCcy === p.ccy ? 1 : (quoteCcy === "USD" && p.ccy === "CAD") ? fx : 1;
    const mvNative = rawQ * quoteToPos * p.qty;
    const fxToCad = p.ccy === "CAD" ? 1 : fx;
    const mvCad = mvNative * fxToCad;
    totalMVCad += mvCad;

    const cat = tickerCategories[ticker];
    if (cat) {
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + mvCad);
    } else {
      uncategorized.push(`${ticker} ($${mvCad.toFixed(0)} CAD)`);
    }
  }

  console.log(`\nTotal MV CAD: $${totalMVCad.toFixed(2)}`);
  if (uncategorized.length > 0) console.log("Uncategorized:", uncategorized.join(", "));

  console.log("\nDrift table:");
  const breaches: Array<{ category: string; driftPct: number; actualPct: number; targetPct: number }> = [];
  for (const cat of new Set([...Object.keys(targets), ...byCategory.keys()])) {
    const targetPct = targets[cat] ?? 0;
    const actualValue = byCategory.get(cat) ?? 0;
    const actualPct = (actualValue / totalMVCad) * 100;
    const driftPct = actualPct - targetPct;
    const breach = Math.abs(driftPct) > driftThreshold;
    const tag = breach ? "⚠ BREACH" : "";
    console.log(`  ${cat.padEnd(28)} target=${targetPct.toFixed(1).padStart(5)}%  actual=${actualPct.toFixed(1).padStart(5)}%  drift=${(driftPct >= 0 ? "+" : "") + driftPct.toFixed(1)}pp  ${tag}`);
    if (breach) breaches.push({ category: cat, driftPct, actualPct, targetPct });
  }
  console.log(`\nBreaches found: ${breaches.length}`);
  if (breaches.length === 0) { console.log("Watcher would return [] here."); return; }

  // Gate 4: sustained breach check
  const snapAgo = new Date(Date.now() - 3 * 86_400_000);
  const oldSnap = await prisma.portfolioSnapshot.findFirst({
    where: { userId: user.id, date: { lte: snapAgo } },
    orderBy: { date: "desc" },
  });
  console.log(`\nGate 4 (sustained breach): oldSnap = ${oldSnap ? oldSnap.date.toISOString().slice(0, 10) : "null (fallback: pass)"}`);
  // When null, the watcher returns true and passes through.

  // Gate 5: existing open PlannedAction
  const openPlan = await prisma.plannedAction.findFirst({
    where: { userId: user.id, kind: "REBALANCE", fulfilledAt: null, dismissedAt: null },
  });
  console.log(`Gate 5: open REBALANCE plan = ${openPlan ? "EXISTS (would suppress)" : "none"}`);

  // Gate 6: cooldown — already-fired same-category in last 7d
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const recent = await prisma.alertEvent.findMany({
    where: {
      userId: user.id,
      firedAt: { gte: cutoff },
      data: { path: ["rule"], equals: "REBALANCE_DUE" },
    },
    select: { data: true },
  });
  const recentCats = new Set(recent.map((e) => (e.data as Record<string, unknown>)?.category).filter((c): c is string => typeof c === "string"));
  console.log(`Gate 6: recent fired categories (7d cooldown) = ${recentCats.size === 0 ? "none" : Array.from(recentCats).join(", ")}`);

  const wouldFire = breaches.filter((b) => !recentCats.has(b.category));
  console.log(`\n→ Would fire ${wouldFire.length} event(s):`);
  for (const b of wouldFire) {
    console.log(`   • ${b.category}: actual ${b.actualPct.toFixed(1)}% vs target ${b.targetPct.toFixed(1)}% (drift ${(b.driftPct >= 0 ? "+" : "") + b.driftPct.toFixed(1)}pp)`);
  }

  await prisma.$disconnect();
})();
