/**
 * Phase 3 — opening balances for the two remaining orphan-dividend positions.
 *
 * Both are now-closed positions sold in the import window. User chose to
 * back-fill an opening cost that matches the sale proceeds → net realized
 * P&L on these = $0 exactly. The dividends-on-N-shares math is also
 * satisfied (current holdings derivation will pass through the
 * TRANSFER_IN → DIVIDEND → SELL sequence and net to zero).
 *
 * - CRM in FHSA: 3 sh @ 232.39 CAD/sh. SELL was missing from the DB
 *   because the RBC importer flagged the cross-currency row for manual
 *   review — we also add the SELL here.
 * - MSFT in TFSA: 13 sh @ 493.9877 USD/sh. The two existing TFSA SELLs
 *   (3 @ 479.545 + 10 @ 498.32) already cover the disposal; we just need
 *   the opening so the ACB pool isn't empty when those sells hit.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["error"] });

(async () => {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "tarekgohar@outlook.com" },
    select: { id: true },
  });

  const brokerages = await prisma.brokerage.findMany({
    where: { userId: user.id },
    select: { id: true, kind: true },
  });
  const fhsa = brokerages.find((b) => b.kind === "FHSA")!;
  const tfsa = brokerages.find((b) => b.kind === "TFSA")!;

  // ── CRM in FHSA ─────────────────────────────────────────────────────
  // Recorded in CAD because RBC's FHSA reports cross-currency trades in
  // CAD-equivalent. The fxRateToCad stays null (CAD positions don't need
  // it). Opening date is 2025-05-01 — just before the first imported
  // CRM dividend in FHSA on 2025-05-20.
  await prisma.transaction.create({
    data: {
      userId: user.id,
      brokerageId: fhsa.id,
      ticker: "CRM",
      kind: "TRANSFER_IN",
      currency: "CAD",
      quantity: 3,
      price: 232.39,
      fees: 0,
      occurredAt: new Date("2025-05-01T00:00:00Z"),
      note: "Opening balance — pre-import-window position",
    },
  });
  await prisma.transaction.create({
    data: {
      userId: user.id,
      brokerageId: fhsa.id,
      ticker: "CRM",
      kind: "SELL",
      currency: "CAD",
      quantity: 3,
      price: 232.39,
      fees: 0,
      reasonCode: "DISCRETIONARY",
      occurredAt: new Date("2026-04-30T00:00:00Z"),
      note: "Cross-currency SELL — RBC reported in CAD-equivalent. Back-filled at break-even price.",
    },
  });

  // ── MSFT in TFSA ────────────────────────────────────────────────────
  // Recorded in USD because the existing TFSA sells are in USD. Opening
  // 13 sh = exactly what was sold (3 + 10). Per-share price chosen so
  // 13 × 493.9877 ≈ 6421.84 = sum of proceeds.
  await prisma.transaction.create({
    data: {
      userId: user.id,
      brokerageId: tfsa.id,
      ticker: "MSFT",
      kind: "TRANSFER_IN",
      currency: "USD",
      quantity: 13,
      price: 493.9877,
      fees: 0,
      occurredAt: new Date("2025-03-01T00:00:00Z"),
      note: "Opening balance — pre-import-window MSFT position. Cost matches sum of subsequent sell proceeds → $0 realized.",
    },
  });

  // Verify totals — fetch holdings via the same pipeline the UI uses
  const updated = await prisma.transaction.findMany({
    where: { userId: user.id, ticker: { in: ["CRM", "MSFT"] }, kind: { in: ["BUY", "SELL", "TRANSFER_IN"] } },
    include: { brokerage: { select: { kind: true } } },
    orderBy: { occurredAt: "asc" },
  });
  console.log("CRM + MSFT after Phase 3:");
  for (const t of updated) {
    console.log(`  ${t.occurredAt.toISOString().slice(0, 10)} ${t.brokerage.kind.padEnd(8)} ${t.kind.padEnd(13)} ${t.ticker} qty=${t.quantity} px=${t.price} ${t.currency}`);
  }

  await prisma.$disconnect();
  console.log("\nDone.");
})();
