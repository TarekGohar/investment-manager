"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Tx } from "@/lib/portfolio/types";
import { deleteTransactionAction } from "@/app/actions/transactions";
import { formatCurrency, formatQty } from "@/lib/format";
import { TickerBadge } from "@/components/ticker-badge";
import { useToast } from "@/components/toast-provider";
import { EditTransactionModal } from "@/components/edit-transaction-modal";
import type {
  TransactionFormBrokerage,
  TransactionFormInitialValues,
} from "@/components/transaction-form";

const KIND_BADGE: Record<Tx["kind"], { label: string; tone: string }> = {
  BUY: { label: "Buy", tone: "bg-success/15 text-success" },
  SELL: { label: "Sell", tone: "bg-danger/15 text-danger" },
  DIVIDEND: { label: "Dividend", tone: "bg-brand/15 text-brand-2" },
  SPLIT: { label: "Split", tone: "bg-warning/15 text-warning" },
  TRANSFER_IN: { label: "Transfer in", tone: "bg-muted/15 text-muted" },
  TRANSFER_OUT: { label: "Transfer out", tone: "bg-muted/15 text-muted" },
  DEPOSIT: { label: "Deposit", tone: "bg-success/15 text-success" },
  WITHDRAWAL: { label: "Withdraw", tone: "bg-warning/15 text-warning" },
};

function dateLabel(d: Date) {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function computedTotal(t: Tx) {
  if (t.kind === "DIVIDEND") return t.price;
  if (t.kind === "SPLIT") return null;
  return t.quantity * t.price + (t.kind === "SELL" ? -t.fees : t.fees);
}

function toEditValues(t: Tx): TransactionFormInitialValues {
  return {
    id: t.id,
    ticker: t.ticker,
    kind: t.kind,
    currency: t.currency,
    dividendType: t.dividendType,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    occurredAt: t.occurredAt,
    note: t.note,
    splitRatio: t.splitRatio,
    brokerageId: t.brokerageId,
  };
}

export function TransactionsList({
  transactions,
  brokerages = [],
}: {
  transactions: Tx[];
  brokerages?: TransactionFormBrokerage[];
}) {
  const [editingTx, setEditingTx] = useState<Tx | null>(null);

  return (
    <>
      <div className="rounded-card border border-border bg-panel">
        <div className="flex items-center justify-between px-4 py-5 md:px-6">
          <h2 className="text-[16px] font-semibold">All transactions</h2>
          <span className="text-sm text-muted">
            {transactions.length} record{transactions.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[110px_1.2fr_110px_0.9fr_0.9fr_1fr_80px] gap-3 border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:px-6">
              <div>Date</div>
              <div>Ticker</div>
              <div>Kind</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Price</div>
              <div className="text-right">Total</div>
              <div></div>
            </div>

            {transactions.map((t) => (
              <Row
                key={t.id}
                t={t}
                onEdit={() => setEditingTx(t)}
              />
            ))}
          </div>
        </div>
      </div>

      <EditTransactionModal
        open={editingTx != null}
        initial={editingTx ? toEditValues(editingTx) : null}
        brokerages={brokerages}
        onClose={() => setEditingTx(null)}
      />
    </>
  );
}

function Row({ t, onEdit }: { t: Tx; onEdit: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const total = computedTotal(t);
  const badge = KIND_BADGE[t.kind];

  function onDelete() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    startTransition(async () => {
      const result = await deleteTransactionAction(t.id);
      if (result.ok) {
        toast({
          title: "Transaction deleted",
          description: `${t.kind} · ${t.ticker ?? "Cash"}`,
          variant: "success",
        });
      } else {
        toast({
          title: "Couldn't delete",
          description: result.error,
          variant: "error",
        });
        setConfirming(false);
      }
    });
  }

  return (
    <div className="grid grid-cols-[110px_1.2fr_110px_0.9fr_0.9fr_1fr_80px] items-center gap-3 border-t border-border px-4 py-4 md:px-6">
      <div className="text-[13px] text-muted">{dateLabel(t.occurredAt)}</div>
      {t.ticker ? (
        <Link
          href={`/positions/${t.ticker}`}
          className="flex min-w-0 items-center gap-3 hover:underline"
        >
          <TickerBadge ticker={t.ticker} size={32} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">{t.ticker}</div>
            {t.note ? <div className="truncate text-xs text-muted">{t.note}</div> : null}
          </div>
        </Link>
      ) : (
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-pill text-[10px] font-semibold text-muted">
            $
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">Cash</div>
            {t.note ? <div className="truncate text-xs text-muted">{t.note}</div> : null}
          </div>
        </div>
      )}
      <div>
        <span
          className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${badge.tone}`}
        >
          {badge.label}
        </span>
      </div>
      <div className="text-right text-[14px] tabular-nums">
        {t.kind === "SPLIT"
          ? `${t.splitRatio?.toFixed(2)}x`
          : t.kind === "DIVIDEND"
            ? "—"
            : formatQty(t.quantity)}
      </div>
      <div className="text-right text-[14px] tabular-nums">
        {t.kind === "SPLIT" ? "—" : t.kind === "DIVIDEND" ? "—" : formatCurrency(t.price)}
      </div>
      <div className="text-right text-[14px] font-semibold tabular-nums">
        {total != null ? formatCurrency(total) : "—"}
      </div>
      <div className="flex justify-end gap-1">
        <button
          type="button"
          aria-label="Edit"
          onClick={onEdit}
          disabled={pending}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-2 transition-colors hover:bg-panel-2 hover:text-text disabled:opacity-50"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={confirming ? "Confirm delete" : "Delete"}
          onClick={onDelete}
          disabled={pending}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
            confirming
              ? "bg-danger/20 text-danger"
              : "text-muted-2 hover:bg-panel-2 hover:text-danger"
          } disabled:opacity-50`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
          </svg>
        </button>
      </div>
    </div>
  );
}
