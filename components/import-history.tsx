"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rollbackImportAction } from "@/app/actions/import";
import { useToast } from "@/components/toast-provider";

export type ImportHistoryRow = {
  id: string;
  sourceFilename: string;
  source: string;
  brokerageName: string;
  transactionCount: number;
  skippedCount: number;
  notes: string | null;
  importedAt: Date;
};

export function ImportHistory({ items }: { items: ImportHistoryRow[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">
        No imports yet. Use the uploader above to bring in your first activity
        export.
      </p>
    );
  }
  return (
    <div className="rounded-[14px] border border-border bg-bg/40">
      {items.map((it) => (
        <Row key={it.id} item={it} />
      ))}
    </div>
  );
}

function Row({ item }: { item: ImportHistoryRow }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onRollback() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    startTransition(async () => {
      const result = await rollbackImportAction(item.id);
      if (!result.ok) {
        toast({ title: "Couldn't roll back", description: result.error, variant: "error" });
        setConfirming(false);
        return;
      }
      toast({
        title: "Import rolled back",
        description: `${result.deleted} transactions deleted.`,
        variant: "success",
      });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold">{item.sourceFilename}</div>
        <div className="mt-0.5 text-xs text-muted">
          {item.source} → {item.brokerageName} ·{" "}
          {new Date(item.importedAt).toLocaleString("en-CA", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          · {item.transactionCount} created
          {item.skippedCount > 0 ? `, ${item.skippedCount} skipped` : ""}
          {item.notes ? ` · ${item.notes}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onRollback}
        disabled={pending}
        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
          confirming
            ? "bg-danger/20 text-danger"
            : "bg-pill text-text hover:bg-pill/70"
        } disabled:opacity-50`}
      >
        {pending ? "Rolling back…" : confirming ? "Confirm rollback" : "Roll back"}
      </button>
    </div>
  );
}
