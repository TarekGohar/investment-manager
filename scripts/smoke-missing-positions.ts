/**
 * Verifies that findMissingPositions surfaces the orphan-dividend tickers
 * from the real DB with correct quantity hints parsed from notes.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

// Inline copy of findMissingPositions — can't import the server-only module
const SHS_RE = /ON\s+([0-9,]+(?:\.[0-9]+)?)\s+SHS/i;
function parseSharesFromNote(note: string | null): number | null {
  if (!note) return null;
  const m = note.match(SHS_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

(async () => {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    console.log(`\n=== ${u.email} ===`);
    const txs = await prisma.transaction.findMany({
      where: {
        userId: u.id,
        ticker: { not: null },
        kind: { in: ["BUY", "SELL", "DIVIDEND", "TRANSFER_IN", "TRANSFER_OUT"] },
      },
      include: { brokerage: { select: { id: true, name: true, kind: true } } },
      orderBy: { occurredAt: "asc" },
    });

    type Bucket = {
      ticker: string;
      brokerageName: string;
      brokerageKind: string;
      hasOpening: boolean;
      dividends: { occurredAt: Date; note: string | null }[];
    };
    const buckets = new Map<string, Bucket>();

    for (const t of txs) {
      const key = `${t.brokerageId}|${t.ticker}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          ticker: t.ticker!,
          brokerageName: t.brokerage.name,
          brokerageKind: t.brokerage.kind,
          hasOpening: false,
          dividends: [],
        };
        buckets.set(key, b);
      }
      if (t.kind === "BUY" || t.kind === "TRANSFER_IN") b.hasOpening = true;
      if (t.kind === "DIVIDEND") {
        b.dividends.push({ occurredAt: t.occurredAt, note: t.note });
      }
    }

    const missing = Array.from(buckets.values())
      .filter((b) => !b.hasOpening && b.dividends.length > 0)
      .sort((a, b) =>
        a.brokerageName === b.brokerageName
          ? a.ticker.localeCompare(b.ticker)
          : a.brokerageName.localeCompare(b.brokerageName),
      );

    if (missing.length === 0) {
      console.log("No missing-position warnings.");
      continue;
    }
    console.log(`${missing.length} ticker(s) need opening balances:`);
    for (const m of missing) {
      const sorted = [...m.dividends].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      const hint = parseSharesFromNote(sorted[0].note);
      console.log(
        `  ${m.ticker.padEnd(8)} in ${m.brokerageName} (${m.brokerageKind})  divs=${m.dividends.length}  hinted-qty=${hint ?? "—"}`,
      );
      console.log(`    sample note: "${sorted[0].note}"`);
    }
  }
  await prisma.$disconnect();
})();
