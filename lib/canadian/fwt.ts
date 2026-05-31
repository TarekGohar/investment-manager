import "server-only";
import { prisma } from "@/lib/prisma";
import type { BrokerageKind } from "@/generated/prisma";
import { isNonRegisteredKind, isRegisteredKind } from "@/lib/portfolio/holdings";

export type FwtRow = {
  year: number;
  ticker: string;
  brokerageKind: BrokerageKind;
  fwtPaid: number;
  dividendsGross: number;
  /** TFSA/FHSA = lost forever; non-reg = recoverable via T1 FTC; RRSP = should be $0 if broker is set up correctly */
  status: "recoverable" | "lost" | "treaty-exempt-or-broker-bug";
};

export type FwtAnnualRollup = {
  year: number;
  totalFwt: number;
  recoverable: number;
  lost: number;
  treatyExemptOrBrokerBug: number;
  rows: FwtRow[];
};

function classifyStatus(kind: BrokerageKind): FwtRow["status"] {
  if (isNonRegisteredKind(kind)) return "recoverable";
  if (kind === "TFSA" || kind === "FHSA" || kind === "RESP") return "lost";
  if (kind === "RRSP" || kind === "LIRA" || kind === "RRIF") return "treaty-exempt-or-broker-bug";
  return "recoverable";
}

export async function getFwtRollupForYear(
  userId: string,
  year: number,
): Promise<FwtAnnualRollup> {
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const end = new Date(`${year + 1}-01-01T00:00:00Z`);

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      kind: "DIVIDEND",
      occurredAt: { gte: start, lt: end },
      foreignTaxWithheld: { not: null },
    },
    include: { brokerage: { select: { kind: true } } },
    orderBy: { occurredAt: "asc" },
  });

  // Aggregate by (ticker, brokerageKind)
  const map = new Map<string, FwtRow>();
  for (const r of rows) {
    if (!r.ticker) continue; // dividend transactions always have a ticker, but TS
    const kind = r.brokerage.kind;
    const fwt = r.foreignTaxWithheld?.toNumber() ?? 0;
    if (fwt <= 0) continue;
    const key = `${r.ticker}:${kind}`;
    const existing = map.get(key) ?? {
      year,
      ticker: r.ticker,
      brokerageKind: kind,
      fwtPaid: 0,
      dividendsGross: 0,
      status: classifyStatus(kind),
    };
    existing.fwtPaid += fwt;
    existing.dividendsGross += r.price.toNumber();
    map.set(key, existing);
  }

  const all = Array.from(map.values());

  let totalFwt = 0;
  let recoverable = 0;
  let lost = 0;
  let treaty = 0;
  for (const r of all) {
    totalFwt += r.fwtPaid;
    if (r.status === "recoverable") recoverable += r.fwtPaid;
    else if (r.status === "lost") lost += r.fwtPaid;
    else treaty += r.fwtPaid;
  }

  return {
    year,
    totalFwt,
    recoverable,
    lost,
    treatyExemptOrBrokerBug: treaty,
    rows: all.sort((a, b) => b.fwtPaid - a.fwtPaid),
  };
}

/**
 * Pull rollups for the last N years so the /tax page can show a trend.
 */
export async function getFwtRollupsRecent(
  userId: string,
  yearsBack = 3,
): Promise<FwtAnnualRollup[]> {
  const thisYear = new Date().getUTCFullYear();
  const years = [];
  for (let i = 0; i <= yearsBack; i++) years.push(thisYear - i);
  return Promise.all(years.map((y) => getFwtRollupForYear(userId, y)));
}

void isRegisteredKind; // re-export only used for caller convenience
