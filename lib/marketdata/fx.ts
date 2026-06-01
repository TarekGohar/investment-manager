import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * CAD-denominated FX rate fetcher backed by the Bank of Canada Valet API.
 *
 * Why this exists: every USD/EUR/etc. cost basis row in a Canadian
 * brokerage must ultimately be expressed in CAD-equivalent for CRA filing.
 * Reconstructing historical FX 2 years later by hand is a nightmare; we
 * capture it at trade entry instead, then cache forever (historical rates
 * never change).
 *
 * The BoC publishes one observation per business day (noon-ish rate). On
 * weekends/holidays we fall back to the most recent prior observation,
 * which is also what CRA accepts.
 */

const BOC_VALET_BASE = "https://www.bankofcanada.ca/valet/observations";

/** Currencies the BoC publishes a CAD pair for. Used to fail fast on typos. */
const SUPPORTED = new Set([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "AUD",
  "CNY",
  "HKD",
  "INR",
  "MXN",
  "NZD",
  "NOK",
  "SEK",
  "SGD",
  "ZAR",
  "TWD",
  "KRW",
  "BRL",
  "PEN",
  "IDR",
  "MYR",
  "RUB",
  "SAR",
  "THB",
  "TRY",
  "VND",
]);

export type FxLookupResult = {
  currency: string;
  /** Calendar date requested (UTC). */
  date: Date;
  /** CAD-equivalent multiplier: `cadAmount = foreignAmount * rate`. */
  rate: number;
  /** The actual BoC observation date used (may be earlier on weekends/holidays). */
  asOf: Date;
  source: "BOC_VALET" | "CACHE";
};

/**
 * Resolve the CAD-equivalent rate for `currency` on `date`. Returns null
 * only on hard failure (unsupported currency, network down, no observation
 * within the look-back window). CAD returns `1.0` trivially.
 */
export async function getFxRateToCad(
  currency: string,
  date: Date,
): Promise<FxLookupResult | null> {
  const cur = currency.toUpperCase();
  if (cur === "CAD") {
    return { currency: "CAD", date, rate: 1, asOf: date, source: "BOC_VALET" };
  }
  if (!SUPPORTED.has(cur)) {
    console.warn(`[fx] unsupported currency ${cur} — BoC has no CAD pair`);
    return null;
  }

  const day = toUtcDay(date);

  // Cache hit?
  const cached = await prisma.fxRate.findUnique({
    where: { currency_date: { currency: cur, date: day } },
  });
  if (cached) {
    return {
      currency: cur,
      date: day,
      rate: Number(cached.rate),
      asOf: cached.asOf,
      source: "CACHE",
    };
  }

  // Miss → hit BoC. Look back 10 days to cover long weekends + stat holidays.
  const series = `FX${cur}CAD`;
  const startStr = formatIsoDate(addDays(day, -10));
  const endStr = formatIsoDate(day);
  const url = `${BOC_VALET_BASE}/${series}/json?start_date=${startStr}&end_date=${endStr}`;

  let payload: BocResponse;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[fx] BoC returned ${res.status} for ${series} ${startStr}..${endStr}`);
      return null;
    }
    payload = (await res.json()) as BocResponse;
  } catch (err) {
    console.error(`[fx] BoC fetch failed for ${series}:`, err);
    return null;
  }

  const obs = payload?.observations ?? [];
  // Walk newest → oldest to find the latest non-null observation at-or-before
  // the requested date.
  for (let i = obs.length - 1; i >= 0; i--) {
    const o = obs[i];
    const raw = o?.[series]?.v;
    if (raw == null || raw === "") continue;
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const asOf = parseIsoDate(o.d);
    if (!asOf) continue;

    await prisma.fxRate.upsert({
      where: { currency_date: { currency: cur, date: day } },
      create: {
        currency: cur,
        date: day,
        rate,
        asOf,
        source: "BOC_VALET",
      },
      update: { rate, asOf },
    });

    return {
      currency: cur,
      date: day,
      rate,
      asOf,
      source: "BOC_VALET",
    };
  }

  console.warn(`[fx] no observation in ${series} ${startStr}..${endStr}`);
  return null;
}

/**
 * Convenience: same as getFxRateToCad but returns just the rate. Used in
 * server actions where we don't need the asOf/source metadata.
 */
export async function fxRateOrNull(currency: string, date: Date): Promise<number | null> {
  const result = await getFxRateToCad(currency, date);
  return result?.rate ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

type BocResponse = {
  observations?: Array<{ d: string } & Record<string, { v: string } | undefined>>;
};

function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, day] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
