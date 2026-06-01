"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewImportAction,
  commitImportAction,
  type PreviewImportResult,
  type PreviewImportableRow,
} from "@/app/actions/import";
import { useToast } from "@/components/toast-provider";
import { formatCurrency, formatQty } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  DIVIDEND: "Dividend",
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdraw",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  SPLIT: "Split",
};

const inputClass =
  "w-full rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-muted-2 focus:border-brand";

export function ImportUploader({
  hasAnyBrokerages,
}: {
  hasAnyBrokerages: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, setFilename] = useState<string>("");
  const [fileText, setFileText] = useState<string>("");
  const [preview, setPreview] = useState<PreviewImportResult | null>(null);
  const [brokerageId, setBrokerageId] = useState<string>("");
  const [skipDupes, setSkipDupes] = useState<Set<number>>(new Set());
  const [skipWithinDupes, setSkipWithinDupes] = useState<Set<number>>(new Set());
  const [pendingPreview, startPreview] = useTransition();
  const [pendingCommit, startCommit] = useTransition();

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setPreview(null);
    setSkipDupes(new Set());
    setSkipWithinDupes(new Set());
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setFileText(text);
      startPreview(async () => {
        const result = await previewImportAction({ filename: file.name, fileText: text });
        if (!result.ok) {
          toast({ title: "Couldn't parse file", description: result.error, variant: "error" });
          setPreview(null);
          return;
        }
        setPreview(result);
        setBrokerageId(result.suggestedBrokerageId ?? "");
        // Default: auto-skip rows already in DB and within-batch duplicates.
        const dbDupes = new Set<number>();
        const wbDupes = new Set<number>();
        for (const r of result.importable) {
          if (r.duplicateOf) dbDupes.add(r.sourceLine);
          if (r.withinBatchDuplicateOfLine != null) wbDupes.add(r.sourceLine);
        }
        setSkipDupes(dbDupes);
        setSkipWithinDupes(wbDupes);
      });
    };
    reader.readAsText(file);
  }

  function toggleSkip(line: number, kind: "db" | "wb") {
    const setter = kind === "db" ? setSkipDupes : setSkipWithinDupes;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  function onCommit() {
    if (!preview || !preview.ok) return;
    if (!brokerageId) {
      toast({ title: "Pick a brokerage first", variant: "error" });
      return;
    }
    const skipped = new Set<number>([...skipDupes, ...skipWithinDupes]);
    const accepted = preview.importable
      .filter((r) => !skipped.has(r.sourceLine))
      .map((r) => r.sourceLine);
    if (accepted.length === 0) {
      toast({ title: "No rows accepted", description: "All rows are marked to skip.", variant: "error" });
      return;
    }
    startCommit(async () => {
      const result = await commitImportAction({
        filename: preview.filename,
        brokerageId,
        acceptedSourceLines: accepted,
        fileText,
      });
      if (!result.ok) {
        toast({ title: "Couldn't import", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: "Import complete",
        description: `${result.created} transactions added.`,
        variant: "success",
      });
      setPreview(null);
      setFilename("");
      setFileText("");
      setSkipDupes(new Set());
      setSkipWithinDupes(new Set());
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  if (!hasAnyBrokerages) {
    return (
      <div className="rounded-[14px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
        Add at least one brokerage in Settings first, then come back. Imports
        need a destination account to assign rows to.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">
            Activity export CSV
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            className="w-full cursor-pointer rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[14px] file:mr-3 file:rounded-md file:border-0 file:bg-pill file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-text hover:file:bg-pill/70"
          />
        </label>
        <p className="mt-2 text-xs text-muted-2">
          RBC Direct Investing → My Portfolio → an account → Activity → Export.
          Up to 15 months per file. You can upload one account at a time.
        </p>
        {pendingPreview ? (
          <p className="mt-2 text-xs text-muted">Parsing…</p>
        ) : null}
      </div>

      {preview && preview.ok ? (
        <>
          <div className="rounded-[14px] border border-border bg-bg/40 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <span className="font-semibold">{preview.filename}</span>{" "}
                <span className="text-muted">
                  · Account {preview.accountNumber} ({preview.accountKind})
                </span>
              </div>
              <div className="flex gap-3 text-xs text-muted">
                <span>
                  <strong className="text-text">{preview.importable.length}</strong>{" "}
                  importable
                </span>
                {preview.skipped.length > 0 ? (
                  <span>
                    <strong className="text-text">{preview.skipped.length}</strong>{" "}
                    skipped
                  </span>
                ) : null}
                {preview.needsReview.length > 0 ? (
                  <span>
                    <strong className="text-text">
                      {preview.needsReview.length}
                    </strong>{" "}
                    need review
                  </span>
                ) : null}
                {preview.errors.length > 0 ? (
                  <span className="text-danger">
                    <strong>{preview.errors.length}</strong> errors
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              Import into brokerage
            </span>
            <select
              value={brokerageId}
              onChange={(e) => setBrokerageId(e.target.value)}
              className={inputClass}
            >
              <option value="">— Pick an account —</option>
              {preview.brokerages.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.kind}){" "}
                  {b.id === preview.suggestedBrokerageId ? "· suggested" : ""}
                </option>
              ))}
            </select>
            {!preview.suggestedBrokerageId ? (
              <p className="mt-1.5 text-xs text-muted-2">
                No brokerage matched the account number or kind. Pick one — or
                add a new one in Settings first.
              </p>
            ) : null}
          </label>

          <div className="rounded-[14px] border border-border bg-panel">
            <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Importable rows
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {preview.importable.map((r) => (
                <ImportableRow
                  key={r.sourceLine}
                  row={r}
                  skipped={skipDupes.has(r.sourceLine) || skipWithinDupes.has(r.sourceLine)}
                  onToggle={() =>
                    toggleSkip(
                      r.sourceLine,
                      r.duplicateOf ? "db" : "wb",
                    )
                  }
                />
              ))}
            </div>
          </div>

          {preview.needsReview.length > 0 ? (
            <details className="rounded-[14px] border border-warning/30 bg-warning/5">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-warning">
                {preview.needsReview.length} row
                {preview.needsReview.length === 1 ? "" : "s"} need manual review →
              </summary>
              <ul className="space-y-2 px-4 pb-3 text-xs text-warning/90">
                {preview.needsReview.map((r) => (
                  <li key={r.sourceLine}>
                    <span className="font-mono text-warning">L{r.sourceLine}</span>
                    {" · "}
                    {r.raw["Activity"]} · {r.raw["Symbol"] || "—"}{" "}
                    {r.raw["Quantity"] ? `· qty ${r.raw["Quantity"]}` : ""}
                    <div className="mt-0.5 text-warning/70">{r.hint}</div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {preview.skipped.length > 0 ? (
            <details className="rounded-[14px] border border-border bg-bg/40">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">
                {preview.skipped.length} row
                {preview.skipped.length === 1 ? "" : "s"} skipped by importer →
              </summary>
              <ul className="space-y-2 px-4 pb-3 text-xs text-muted">
                {preview.skipped.map((r) => (
                  <li key={r.sourceLine}>
                    <span className="font-mono">L{r.sourceLine}</span> · {r.reason}
                    <div className="mt-0.5 text-muted-2">{r.hint}</div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <button
            type="button"
            onClick={onCommit}
            disabled={pendingCommit || !brokerageId}
            className="w-full rounded-[28px] bg-gradient-to-r from-brand to-brand-3 py-[15px] text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingCommit
              ? "Importing…"
              : `Import ${
                  preview.importable.length - skipDupes.size - skipWithinDupes.size
                } transactions`}
          </button>
        </>
      ) : null}
    </div>
  );
}

function ImportableRow({
  row,
  skipped,
  onToggle,
}: {
  row: PreviewImportableRow;
  skipped: boolean;
  onToggle: () => void;
}) {
  const isDupe = row.duplicateOf != null;
  const isWithinDupe = row.withinBatchDuplicateOfLine != null;
  return (
    <div
      className={`grid grid-cols-[60px_90px_80px_60px_1fr_1.2fr_28px] items-center gap-3 border-t border-border px-4 py-2 text-[13px] ${
        skipped ? "opacity-50" : ""
      }`}
    >
      <div className="font-mono text-[11px] text-muted-2">L{row.sourceLine}</div>
      <div className="text-muted">
        {row.occurredAt.toISOString().slice(0, 10)}
      </div>
      <div className="font-semibold">{KIND_LABEL[row.kind] ?? row.kind}</div>
      <div className="font-mono text-[12px]">{row.ticker ?? "—"}</div>
      <div className="tabular-nums">
        {row.kind === "DEPOSIT" || row.kind === "WITHDRAWAL" || row.kind === "DIVIDEND"
          ? formatCurrency(row.price)
          : `${formatQty(row.quantity)} @ ${formatCurrency(row.price)}${row.fees > 0 ? ` · fee ${formatCurrency(row.fees)}` : ""}`}
        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-2">
          {row.currency}
        </span>
      </div>
      <div className="text-[11px] text-muted-2">
        {isDupe ? (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">
            Already in DB ({row.duplicateOf?.occurredAt.slice(0, 10)})
          </span>
        ) : isWithinDupe ? (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">
            Duplicate of L{row.withinBatchDuplicateOfLine}
          </span>
        ) : (
          <span className="text-muted-2">{row.note?.slice(0, 50) ?? ""}</span>
        )}
      </div>
      {isDupe || isWithinDupe ? (
        <input
          type="checkbox"
          checked={!skipped}
          onChange={onToggle}
          aria-label="Include despite duplicate warning"
          className="h-4 w-4 accent-brand"
        />
      ) : (
        <span />
      )}
    </div>
  );
}
