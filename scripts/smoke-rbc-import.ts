/**
 * Translator smoke test against the user's actual RBC DI exports.
 * Run with: npx tsx scripts/smoke-rbc-import.ts
 *
 * Does NOT write to the database. Just exercises the parser + translator
 * on each file and prints a summary so we can eyeball the classifications.
 */
import { readFileSync } from "node:fs";
import { translateRbcDi, type ImportableTx, type SkippedRow, type ReviewRow, type ErrorRow } from "../lib/import/rbc-di";

const FILES = [
  "/Users/tarekgohar/Downloads/Activity 57819938 May 31, 2026.csv",
  "/Users/tarekgohar/Downloads/Activity 26725812 May 31, 2026.csv",
  "/Users/tarekgohar/Downloads/Activity 20619437 May 31, 2026.csv",
];

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function printTx(t: ImportableTx) {
  const ticker = t.ticker ?? "—";
  const dt = t.dividendType ? `[${t.dividendType}]` : "";
  console.log(
    `  L${String(t.sourceLine).padStart(3)}  ${fmtDate(t.occurredAt)}  ${t.kind.padEnd(11)}  ${ticker.padEnd(6)}  qty=${String(t.quantity).padStart(8)}  px=${String(t.price).padStart(9)}  fees=${String(t.fees).padStart(6)}  ${t.currency}  ${dt} ${t.note ? `· ${t.note.slice(0, 60)}` : ""}`,
  );
}

function printSkip(s: SkippedRow) {
  console.log(
    `  L${String(s.sourceLine).padStart(3)}  SKIP  ${s.reason.padEnd(20)}  ${s.raw["Activity"]?.padEnd(35)}  → ${s.hint.slice(0, 80)}`,
  );
}

function printReview(r: ReviewRow) {
  console.log(
    `  L${String(r.sourceLine).padStart(3)}  REVIEW  ${r.reason}  ${r.raw["Activity"]} · ${r.raw["Symbol"]}  ${r.raw["Quantity"]} @ ${r.raw["Price"]}  ${r.raw["Description"].slice(0, 80)}`,
  );
}

function printError(e: ErrorRow) {
  console.log(`  L${String(e.sourceLine).padStart(3)}  ERROR  ${e.error}  · raw activity: ${e.raw["Activity"]}`);
}

function processFile(path: string) {
  const text = readFileSync(path, "utf8");
  const result = translateRbcDi(text);

  console.log(`\n=== ${path.split("/").pop()} ===`);
  console.log(`Account: ${result.accountNumber} (${result.accountKind})`);
  console.log(
    `Importable: ${result.importableTxs.length}   Skipped: ${result.skipped.length}   Needs review: ${result.needsReview.length}   Errors: ${result.errors.length}`,
  );

  if (result.importableTxs.length > 0) {
    console.log("\n  Importable transactions:");
    result.importableTxs.forEach(printTx);
  }
  if (result.skipped.length > 0) {
    console.log("\n  Skipped:");
    result.skipped.forEach(printSkip);
  }
  if (result.needsReview.length > 0) {
    console.log("\n  Needs review:");
    result.needsReview.forEach(printReview);
  }
  if (result.errors.length > 0) {
    console.log("\n  Errors:");
    result.errors.forEach(printError);
  }
}

for (const f of FILES) processFile(f);
console.log("\nDone.");
