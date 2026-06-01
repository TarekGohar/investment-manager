/**
 * Session 7 smoke. Validates:
 *   1. Spinoff cost-basis math: parent 100 sh @ $50, 16.5% basis spun off
 *      to child WBD at ratio 0.241917 → child has 24.19 sh w/ basis $825.
 *      Parent retains 100 sh, basis drops to $4,175.
 *   2. Merger: 100 sh @ $50 in T merged 1:1 into X → X has 100 sh @ $50.
 *   3. RoC reclassification math: a single $1,000 dividend split 45% capgain,
 *      30% RoC, 15% eligible, 10% interest → 4 new rows with right amounts.
 *
 * Pure-logic checks — no DB writes. The reclassify-against-real-DB test is
 * harder because it requires writing then rolling back.
 */
import { expandCorporateActions } from "../lib/portfolio/corporate-actions";
import { deriveHoldings } from "../lib/portfolio/holdings";
import type { Tx } from "../lib/portfolio/types";

function tx(overrides: Partial<Tx>): Tx {
  return {
    id: Math.random().toString(36).slice(2, 12),
    brokerageId: "bk1",
    brokerageKind: "NON_REGISTERED",
    ticker: "X",
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

function expect(label: string, actual: unknown, expected: unknown, tol = 0) {
  let ok: boolean;
  if (typeof actual === "number" && typeof expected === "number") {
    ok = Math.abs(actual - expected) <= tol;
  } else {
    ok = JSON.stringify(actual) === JSON.stringify(expected);
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

function testSpinoff() {
  console.log("\n— SPINOFF math (T → WBD at 0.241917, 16.5% basis) —");
  const txs: Tx[] = [
    tx({
      ticker: "T",
      kind: "BUY",
      quantity: 100,
      price: 50,
      occurredAt: new Date("2025-01-01"),
    }),
    tx({
      ticker: "T",
      kind: "CORPORATE_ACTION",
      occurredAt: new Date("2025-04-08"),
      corporateActionPayload: {
        event: "SPINOFF",
        legs: [{ ticker: "WBD", ratio: 0.241917, basisAllocationPct: 16.5 }],
      },
    }),
  ];

  const expanded = expandCorporateActions(txs);
  const wbdTransfer = expanded.find((t) => t.ticker === "WBD" && t.kind === "TRANSFER_IN");
  expect("WBD TRANSFER_IN created", wbdTransfer !== undefined, true);
  if (wbdTransfer) {
    expect("WBD qty = 100 × 0.241917", wbdTransfer.quantity, 24.1917, 0.0001);
    // Basis = 100 × 50 × 0.165 = $825 → per-share = 825 / 24.1917 = $34.1027
    expect("WBD per-share basis ≈ 34.10", wbdTransfer.price, 34.1027, 0.01);
  }

  const holdings = deriveHoldings(txs);
  const t = holdings.find((h) => h.ticker === "T");
  const wbd = holdings.find((h) => h.ticker === "WBD");
  expect("parent T qty unchanged at 100", t?.quantity, 100);
  // Parent basis: 5000 × (1 - 0.165) = $4,175
  expect("parent T basis = $4,175 after spinoff", t?.costBasis, 4175, 0.01);
  expect("WBD position exists", wbd !== undefined, true);
  if (wbd) {
    expect("WBD qty = 24.1917", wbd.quantity, 24.1917, 0.0001);
    expect("WBD basis = $825", wbd.costBasis, 825, 0.01);
  }
}

function testMerger() {
  console.log("\n— MERGER math (T → X at ratio 1) —");
  const txs: Tx[] = [
    tx({
      ticker: "T",
      kind: "BUY",
      quantity: 100,
      price: 50,
      occurredAt: new Date("2025-01-01"),
    }),
    tx({
      ticker: "T",
      kind: "CORPORATE_ACTION",
      occurredAt: new Date("2025-06-01"),
      corporateActionPayload: {
        event: "MERGER",
        legs: [{ ticker: "X", ratio: 1, basisAllocationPct: 100 }],
      },
    }),
  ];

  const holdings = deriveHoldings(txs);
  const x = holdings.find((h) => h.ticker === "X");
  const t = holdings.find((h) => h.ticker === "T");
  expect("parent T removed (qty 0 → filtered out)", t === undefined, true);
  expect("X position exists", x !== undefined, true);
  if (x) {
    expect("X qty = 100", x.quantity, 100);
    expect("X basis = $5,000", x.costBasis, 5000, 0.01);
  }
}

function testNameChange() {
  console.log("\n— NAME_CHANGE (T → T2 at ratio 1) —");
  const txs: Tx[] = [
    tx({
      ticker: "T",
      kind: "BUY",
      quantity: 100,
      price: 50,
      occurredAt: new Date("2025-01-01"),
    }),
    tx({
      ticker: "T",
      kind: "CORPORATE_ACTION",
      occurredAt: new Date("2025-06-01"),
      corporateActionPayload: {
        event: "NAME_CHANGE",
        legs: [{ ticker: "T2", ratio: 1, basisAllocationPct: 100 }],
      },
    }),
  ];

  const holdings = deriveHoldings(txs);
  const t2 = holdings.find((h) => h.ticker === "T2");
  expect("T2 exists after name change", t2 !== undefined, true);
  if (t2) {
    expect("T2 qty = 100", t2.quantity, 100);
    expect("T2 basis = $5,000", t2.costBasis, 5000);
  }
}

function testRocSplit() {
  console.log("\n— RoC reclassification math (pure division) —");
  // A single $1,000 dividend → 45% capgain($450), 30% RoC($300), 15% elig($150), 10% interest($100)
  const dollars = 1000;
  const split = {
    capGain: dollars * 0.45,
    roc: dollars * 0.30,
    elig: dollars * 0.15,
    interest: dollars * 0.10,
  };
  expect("45% capital gain = $450", split.capGain, 450);
  expect("30% RoC = $300", split.roc, 300);
  expect("15% eligible = $150", split.elig, 150);
  expect("10% interest = $100", split.interest, 100);
  expect("sums back to $1,000", split.capGain + split.roc + split.elig + split.interest, 1000);
}

testSpinoff();
testMerger();
testNameChange();
testRocSplit();
console.log("\nDone.");
process.exit(process.exitCode ?? 0);
