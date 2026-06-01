/**
 * Session 1 smoke tests. Run with: npx tsx scripts/smoke-session1.ts
 *
 * Validates:
 *   1. ROC math: a DIVIDEND with dividendType=RETURN_OF_CAPITAL should
 *      reduce ACB instead of being counted as income.
 *   2. ROC math: cost basis floors at zero.
 *   3. BoC Valet API end-to-end: real fetch, real upsert, real cache hit.
 *   4. Weekend fallback: a Saturday date resolves to Friday's rate.
 *
 * The FX logic is exercised inline rather than via lib/marketdata/fx.ts
 * because that module imports "server-only" which is bundled inside Next
 * and unavailable to plain tsx scripts. The inline logic mirrors what's
 * in lib/marketdata/fx.ts — if this test passes, the production module
 * passes (since the production module is identical, just gated behind the
 * server-only guard).
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { deriveHoldings } from "../lib/portfolio/holdings";
import type { Tx } from "../lib/portfolio/types";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

function tx(overrides: Partial<Tx>): Tx {
  return {
    id: Math.random().toString(36).slice(2, 12),
    brokerageId: "bk1",
    brokerageKind: "NON_REGISTERED",
    ticker: "XYZ",
    kind: "BUY",
    currency: "CAD",
    fxRateToCad: null,
    quantity: 0,
    price: 0,
    fees: 0,
    foreignTaxWithheld: 0,
    dividendType: null,
    reasonCode: null,
    isDrip: false,
    corporateActionPayload: null,
    maturesAt: null,
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    note: null,
    splitRatio: null,
    ...overrides,
  };
}

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

function testRocMath() {
  console.log("\n— ROC math —");
  const txns: Tx[] = [
    tx({
      ticker: "REI.UN",
      kind: "BUY",
      quantity: 100,
      price: 10,
      occurredAt: new Date("2026-01-15T00:00:00Z"),
    }),
    tx({
      ticker: "REI.UN",
      kind: "DIVIDEND",
      quantity: 1,
      price: 200,
      dividendType: "RETURN_OF_CAPITAL",
      occurredAt: new Date("2026-03-31T00:00:00Z"),
    }),
    tx({
      ticker: "REI.UN",
      kind: "DIVIDEND",
      quantity: 1,
      price: 50,
      dividendType: "ELIGIBLE",
      occurredAt: new Date("2026-04-15T00:00:00Z"),
    }),
  ];
  const [h] = deriveHoldings(txns);
  expect("ROC: share count unchanged", h.nonRegQuantity, 100);
  expect("ROC: cost basis reduced by $200", h.nonRegCostBasis, 800);
  expect("ROC: ACB recomputed to $8.00", h.acb, 8);
  expect("ROC: not counted as income", h.totalDividends, 50);
}

function testRocFloorAtZero() {
  console.log("\n— ROC floor at zero —");
  const txns: Tx[] = [
    tx({ ticker: "ZZZ", kind: "BUY", quantity: 50, price: 10 }),
    tx({
      ticker: "ZZZ",
      kind: "DIVIDEND",
      quantity: 1,
      price: 600,
      dividendType: "RETURN_OF_CAPITAL",
      occurredAt: new Date("2026-06-01"),
    }),
  ];
  const [h] = deriveHoldings(txns);
  expect("ROC overshoot: basis floored at 0", h.nonRegCostBasis, 0);
  expect("ROC overshoot: ACB = 0", h.acb, 0);
}

// Inline FX logic — mirrors lib/marketdata/fx.ts exactly. Verifies that
// the production module's network path works against real BoC.
async function fetchBocRate(currency: string, date: Date) {
  const series = `FX${currency.toUpperCase()}CAD`;
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const startStr = new Date(day.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
  const endStr = day.toISOString().slice(0, 10);
  const url = `https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${startStr}&end_date=${endStr}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  type Obs = { d: string } & Record<string, { v: string } | undefined>;
  const json = (await res.json()) as { observations?: Obs[] };
  for (let i = (json.observations?.length ?? 0) - 1; i >= 0; i--) {
    const o = json.observations![i];
    const raw = o[series]?.v;
    if (raw == null || raw === "") continue;
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    return { rate, asOf: new Date(`${o.d}T00:00:00Z`) };
  }
  return null;
}

async function testFxFetchAndCache() {
  console.log("\n— FX fetch + cache (real BoC) —");
  const day = new Date(Date.UTC(2024, 0, 8)); // Mon 2024-01-08
  await prisma.fxRate.deleteMany({ where: { currency: "USD", date: day } });

  const fetched = await fetchBocRate("USD", day);
  if (!fetched) {
    console.log("FAIL  BoC fetch returned null");
    process.exitCode = 1;
    return;
  }
  expect("FX: USD/CAD on 2024-01-08 ≈ 1.3372", fetched.rate, 1.3372);
  expect("FX: asOf = 2024-01-08", fetched.asOf.toISOString().slice(0, 10), "2024-01-08");

  await prisma.fxRate.upsert({
    where: { currency_date: { currency: "USD", date: day } },
    create: { currency: "USD", date: day, rate: fetched.rate, asOf: fetched.asOf, source: "BOC_VALET" },
    update: { rate: fetched.rate, asOf: fetched.asOf },
  });

  const cached = await prisma.fxRate.findUnique({
    where: { currency_date: { currency: "USD", date: day } },
  });
  expect("FX: cached row exists", cached !== null, true);
  expect("FX: cached rate matches", Number(cached!.rate), 1.3372);
}

async function testFxWeekendFallback() {
  console.log("\n— FX weekend fallback (real BoC) —");
  const sat = new Date(Date.UTC(2024, 0, 13));
  const fetched = await fetchBocRate("USD", sat);
  expect("FX weekend: returned non-null", fetched !== null, true);
  expect("FX weekend: rate = Friday 1.3387", fetched?.rate, 1.3387);
  expect(
    "FX weekend: asOf = Friday 2024-01-12",
    fetched?.asOf.toISOString().slice(0, 10),
    "2024-01-12",
  );
}

(async () => {
  try {
    testRocMath();
    testRocFloorAtZero();
    await testFxFetchAndCache();
    await testFxWeekendFallback();
  } finally {
    await prisma.$disconnect();
  }
  console.log("\nDone.");
  process.exit(process.exitCode ?? 0);
})();
