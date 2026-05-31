"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createTransactionAction,
  updateTransactionAction,
} from "@/app/actions/transactions";
import {
  checkSuperficialLossAction,
  type SuperficialLossCheck,
} from "@/app/actions/superficial-loss";
import {
  checkContributionRoomImpactAction,
  type ContributionRoomImpactCheck,
} from "@/app/actions/contribution-room-check";
import { useToast } from "@/components/toast-provider";
import { formatCurrency } from "@/lib/format";
import type { BrokerageKind } from "@/generated/prisma";

const KINDS = ["BUY", "SELL", "DIVIDEND", "SPLIT", "DEPOSIT", "WITHDRAWAL"] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = {
  BUY: "Buy",
  SELL: "Sell",
  DIVIDEND: "Dividend",
  SPLIT: "Split",
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdraw",
};

const CASH_TICKER = "$CASH";

const inputClass =
  "w-full rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-muted-2 focus:border-brand";

export type TransactionFormBrokerage = {
  id: string;
  name: string;
  kind: BrokerageKind;
};

export type TransactionFormInitialValues = {
  id: string;
  ticker: string;
  kind: Kind | "TRANSFER_IN" | "TRANSFER_OUT";
  quantity: number;
  price: number;
  fees: number;
  occurredAt: Date;
  note: string | null;
  splitRatio: number | null;
  brokerageId: string;
};

export function TransactionForm({
  defaultTicker = "",
  brokerages = [],
  initial,
  onSaved,
  variant = "card",
}: {
  defaultTicker?: string;
  brokerages?: TransactionFormBrokerage[];
  initial?: TransactionFormInitialValues;
  onSaved?: () => void;
  /** Visual variant: "card" for full panel, "plain" for embedded use inside a modal */
  variant?: "card" | "plain";
}) {
  const editing = initial != null;
  const startingKind: Kind =
    initial && (KINDS as readonly string[]).includes(initial.kind as string)
      ? (initial.kind as Kind)
      : "BUY";

  const toast = useToast();
  const [kind, setKind] = useState<Kind>(startingKind);
  const [ticker, setTicker] = useState(initial?.ticker ?? defaultTicker);
  const [brokerageId, setBrokerageId] = useState<string>(
    initial?.brokerageId ?? (brokerages[0]?.id ?? ""),
  );

  // Initialize form fields from initial values when editing
  const [quantity, setQuantity] = useState(() => {
    if (!initial) return "";
    if (initial.kind === "DIVIDEND" || initial.kind === "SPLIT") return "";
    return String(initial.quantity);
  });
  const [price, setPrice] = useState(() => {
    if (!initial) return "";
    if (initial.kind === "DIVIDEND" || initial.kind === "SPLIT") return "";
    return String(initial.price);
  });
  const [amount, setAmount] = useState(() => {
    if (!initial) return "";
    if (initial.kind === "DIVIDEND" || initial.kind === "DEPOSIT" || initial.kind === "WITHDRAWAL") {
      return String(initial.price);
    }
    return "";
  });
  const [splitRatio, setSplitRatio] = useState(() => {
    if (!initial || initial.kind !== "SPLIT" || initial.splitRatio == null) return "";
    return String(initial.splitRatio);
  });
  const [fees, setFees] = useState(() => (initial && initial.fees > 0 ? String(initial.fees) : ""));
  const [occurredAt, setOccurredAt] = useState(() => {
    const d = initial?.occurredAt ?? new Date();
    return d.toISOString().slice(0, 10);
  });
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Pre-trade superficial-loss warning — only checked when BUY is selected
  // and we have a ticker + date.
  const [superficialCheck, setSuperficialCheck] = useState<SuperficialLossCheck | null>(null);
  const [roomCheck, setRoomCheck] = useState<ContributionRoomImpactCheck | null>(null);

  const selectedBrokerage = brokerages.find((b) => b.id === brokerageId);

  useEffect(() => {
    if (kind !== "BUY") {
      setSuperficialCheck(null);
      return;
    }
    const trimmed = ticker.trim().toUpperCase();
    if (trimmed.length < 1 || !occurredAt) {
      setSuperficialCheck(null);
      return;
    }
    let cancelled = false;
    // Light debounce to avoid spamming the action on every keystroke
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkSuperficialLossAction(trimmed, occurredAt);
        if (!cancelled) setSuperficialCheck(result);
      } catch {
        if (!cancelled) setSuperficialCheck(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, ticker, occurredAt]);

  // Pre-trade contribution-room warning — fires when DEPOSIT is selected
  // into a registered (TFSA/RRSP/FHSA/RESP) account. Used room is now
  // driven by deposits (CRA-correct), so the warning belongs on the
  // deposit, not on the share BUY.
  useEffect(() => {
    if (kind !== "DEPOSIT" || !selectedBrokerage || !occurredAt) {
      setRoomCheck(null);
      return;
    }
    const aN = Number(amount);
    if (!Number.isFinite(aN) || aN <= 0) {
      setRoomCheck(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkContributionRoomImpactAction(
          selectedBrokerage.id,
          occurredAt,
          aN,
        );
        if (!cancelled) setRoomCheck(result);
      } catch {
        if (!cancelled) setRoomCheck(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, selectedBrokerage, occurredAt, amount]);

  const showShareFields = kind === "BUY" || kind === "SELL";
  const showAmount = kind === "DIVIDEND" || kind === "DEPOSIT" || kind === "WITHDRAWAL";
  const showSplit = kind === "SPLIT";
  const showTicker = kind !== "DEPOSIT" && kind !== "WITHDRAWAL";
  const isCashFlow = kind === "DEPOSIT" || kind === "WITHDRAWAL";

  const qNum = Number(quantity);
  const pNum = Number(price);
  const fNum = Number(fees);
  const total =
    Number.isFinite(qNum) && Number.isFinite(pNum) && qNum > 0 && pNum >= 0
      ? qNum * pNum + (Number.isFinite(fNum) ? fNum : 0) * (kind === "SELL" ? -1 : 1)
      : null;

  function resetFields() {
    setQuantity("");
    setPrice("");
    setAmount("");
    setSplitRatio("");
    setFees("");
    setNote("");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("kind", kind);
    if (brokerageId) fd.set("brokerageId", brokerageId);
    // Cash flows have no ticker — the server still requires a non-empty
    // ticker field, so we inject a sentinel that downstream queries filter
    // out of holdings/ACB logic.
    if (isCashFlow) fd.set("ticker", CASH_TICKER);

    startTransition(async () => {
      const result = editing
        ? await updateTransactionAction(initial!.id, fd)
        : await createTransactionAction(fd);

      if (!result.ok) {
        setError(result.error);
        toast({
          title: editing ? "Couldn't save changes" : "Couldn't save",
          description: result.error,
          variant: "error",
        });
        return;
      }

      toast({
        title: editing ? "Transaction updated" : "Transaction recorded",
        description: `${KIND_LABEL[kind]} · ${ticker.toUpperCase()}`,
        variant: "success",
      });

      if (editing) {
        onSaved?.();
      } else {
        resetFields();
        onSaved?.();
      }
    });
  }

  const wrapperClass =
    variant === "card"
      ? "rounded-[22px] border border-border bg-panel p-[22px]"
      : "";

  return (
    <form onSubmit={onSubmit} className={wrapperClass}>
      {variant === "card" ? (
        <h2 className="mb-5 text-[20px] font-semibold">
          {editing ? "Edit transaction" : "New transaction"}
        </h2>
      ) : null}

      {/* Kind segmented */}
      <div className="mb-6 grid grid-cols-3 gap-1 rounded-[20px] bg-pill p-[5px]">
        {KINDS.map((k) => {
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-[16px] py-[8px] text-[13px] font-semibold transition-colors ${
                active ? "bg-white text-bg" : "text-muted hover:text-text"
              }`}
            >
              {KIND_LABEL[k]}
            </button>
          );
        })}
      </div>

      {showTicker ? (
        <Field label="Ticker">
          <input
            name="ticker"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={10}
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL"
            className={`${inputClass} font-mono uppercase tracking-wide`}
          />
        </Field>
      ) : null}

      {brokerages.length > 1 ? (
        <Field label="Brokerage">
          <select
            name="brokerageId"
            value={brokerageId}
            onChange={(e) => setBrokerageId(e.target.value)}
            className={inputClass}
          >
            {brokerages.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {showShareFields ? (
        <>
          <Field label="Quantity (shares)">
            <input
              name="quantity"
              type="number"
              inputMode="decimal"
              step="any"
              required
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="50"
              className={inputClass}
            />
          </Field>
          <Field label="Price per share ($)">
            <input
              name="price"
              type="number"
              inputMode="decimal"
              step="any"
              required
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="189.50"
              className={inputClass}
            />
          </Field>
          <Field label="Fees ($)">
            <input
              name="fees"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </Field>
          {total != null && total > 0 ? (
            <div className="mt-1 mb-3 flex items-baseline justify-between rounded-[10px] bg-bg px-3 py-2.5">
              <span className="text-xs font-medium text-muted">
                {kind === "SELL" ? "Net proceeds" : "Total cost"}
              </span>
              <span className="text-[15px] font-semibold tabular-nums">
                {formatCurrency(total)}
              </span>
            </div>
          ) : null}
          {kind === "BUY" && superficialCheck?.violates ? (
            <div className="mb-3 rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning">
              <div className="text-[13px] font-semibold">
                Superficial loss risk
              </div>
              <div className="mt-1 text-warning/90">
                You sold {superficialCheck.ticker} at a loss of{" "}
                {formatCurrency(superficialCheck.lossAmount)} on{" "}
                {new Date(superficialCheck.saleDate).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                . Buying it back today violates the 30-day rule —{" "}
                {superficialCheck.daysRemaining} day
                {superficialCheck.daysRemaining === 1 ? "" : "s"} left in the window.
                The loss will be disallowed and added to this purchase&apos;s ACB.
              </div>
              <div className="mt-1 text-warning/70">
                To realize the loss cleanly, wait until{" "}
                {new Date(superficialCheck.windowEndsAt).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {" "}or buy a non-identical replacement (see /tax).
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {showAmount ? (
        <Field
          label={
            kind === "DIVIDEND"
              ? "Amount received ($)"
              : kind === "DEPOSIT"
                ? "Amount deposited ($)"
                : "Amount withdrawn ($)"
          }
          help={
            isCashFlow
              ? `Cash ${kind === "DEPOSIT" ? "moved into" : "moved out of"} the ${selectedBrokerage?.name ?? "account"} from an external source.`
              : undefined
          }
        >
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            step="any"
            required
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="48.00"
            className={inputClass}
          />
        </Field>
      ) : null}

      {kind === "DEPOSIT" && roomCheck?.tracked ? (
        <div
          className={`mb-3 rounded-[10px] border px-3 py-2.5 text-xs leading-relaxed ${
            roomCheck.wouldExceed
              ? "border-danger/40 bg-danger/10 text-danger"
              : roomCheck.remainingAfter < 1000
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border bg-bg/40 text-muted"
          }`}
        >
          <div className="text-[13px] font-semibold">
            {roomCheck.wouldExceed
              ? `Would exceed ${roomCheck.kind} room`
              : `${roomCheck.kind} room · ${roomCheck.year}`}
          </div>
          <div className="mt-1">
            Room available: {formatCurrency(roomCheck.roomAvailable)} ·
            Deposited so far: {formatCurrency(roomCheck.currentUsed)} ·
            Remaining: {formatCurrency(roomCheck.remainingBefore)}
          </div>
          <div className="mt-1">
            This deposit: {formatCurrency(roomCheck.proposedAmount)} →{" "}
            remaining after: {formatCurrency(roomCheck.remainingAfter)}
            {roomCheck.wouldExceed
              ? " — CRA penalises 1%/month on TFSA / FHSA over-contributions."
              : ""}
          </div>
        </div>
      ) : null}

      {showSplit ? (
        <Field
          label="New shares per old share"
          help="e.g. 2 for a 2-for-1 split. 0.1 for a 1-for-10 reverse split."
        >
          <input
            name="splitRatio"
            type="number"
            inputMode="decimal"
            step="any"
            required
            min="0"
            value={splitRatio}
            onChange={(e) => setSplitRatio(e.target.value)}
            placeholder="2"
            className={inputClass}
          />
        </Field>
      ) : null}

      <Field label="Date">
        <input
          name="occurredAt"
          type="date"
          required
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Note (optional)">
        <input
          name="note"
          type="text"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Initial position"
          className={inputClass}
        />
      </Field>

      {error ? (
        <div className="mb-3 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-[28px] bg-gradient-to-r from-brand to-brand-3 py-[15px] text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? editing
            ? "Saving…"
            : "Recording…"
          : editing
            ? "Save changes"
            : `Record ${KIND_LABEL[kind].toLowerCase()}`}
      </button>
    </form>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {help ? <span className="mt-1 block text-xs text-muted-2">{help}</span> : null}
    </label>
  );
}
