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
import { lookupFxRateAction, type FxLookupActionResult } from "@/app/actions/fx";
import {
  checkDuplicateTransactionAction,
  type DuplicateMatch,
} from "@/app/actions/duplicate-check";
import {
  checkPreEntryGuardsAction,
  type PreEntryWarning,
} from "@/app/actions/pre-entry-guards";
import { useToast } from "@/components/toast-provider";
import { formatCurrency } from "@/lib/format";
import type { BrokerageKind, DividendType, SellReason } from "@/generated/prisma";

const KINDS = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "SPLIT",
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = {
  BUY: "Buy",
  SELL: "Sell",
  DIVIDEND: "Dividend",
  SPLIT: "Split",
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdraw",
  TRANSFER_IN: "Opening / In",
  TRANSFER_OUT: "Transfer out",
};

const inputClass =
  "w-full rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-muted-2 focus:border-brand";

export type TransactionFormBrokerage = {
  id: string;
  name: string;
  kind: BrokerageKind;
  /** Default currency for transactions in this brokerage. Per-tx override allowed. */
  currency: string;
};

export type TransactionFormInitialValues = {
  id: string;
  ticker: string | null;
  kind: Kind | "TRANSFER_IN" | "TRANSFER_OUT";
  currency: string;
  fxRateToCad: number | null;
  dividendType: DividendType | null;
  reasonCode: SellReason | null;
  isDrip: boolean;
  quantity: number;
  price: number;
  fees: number;
  occurredAt: Date;
  note: string | null;
  splitRatio: number | null;
  brokerageId: string;
};

const DIVIDEND_TYPE_OPTIONS: Array<{ value: DividendType; label: string; hint: string }> = [
  { value: "ELIGIBLE", label: "Eligible", hint: "Most CA public-company dividends (lower combined rate)" },
  { value: "NON_ELIGIBLE", label: "Non-eligible", hint: "CCPC small-business-pool dividends" },
  { value: "INTEREST", label: "Interest", hint: "Bond coupons, GICs — taxed as ordinary income" },
  { value: "FOREIGN", label: "Foreign", hint: "US / international dividends — often with FWT" },
  { value: "RETURN_OF_CAPITAL", label: "Return of capital", hint: "Reduces ACB instead of being income (REITs)" },
  { value: "OTHER", label: "Other", hint: "Capital-gains distribution, special distribution" },
];

const SELL_REASON_OPTIONS: Array<{ value: SellReason; label: string; hint: string }> = [
  { value: "REBALANCE_DRIFT", label: "Rebalance drift", hint: "Trimming an over-weight position back to IPS target" },
  { value: "THESIS_INVALIDATED", label: "Thesis invalidated", hint: "Written invalidation criterion was met — thesis broken" },
  { value: "TLH_HARVEST", label: "Tax-loss harvest", hint: "Realizing a loss to offset gains" },
  { value: "TAX_PLANNING", label: "Tax planning", hint: "Other tax-driven sell (realize gain before bracket change, etc.)" },
  { value: "CASH_NEED", label: "Cash need", hint: "Need the proceeds for a non-investment expense" },
  { value: "DISCRETIONARY", label: "Discretionary", hint: "None of the above — flagged in behavioral patterns" },
];

const COMMON_CURRENCIES = ["CAD", "USD", "EUR", "GBP"];

const REGISTERED_KINDS_SET = new Set<BrokerageKind>([
  "TFSA",
  "RRSP",
  "FHSA",
  "RESP",
  "LIRA",
  "RRIF",
]);

export function TransactionForm({
  defaultTicker = "",
  defaultBrokerageId,
  defaultKind,
  defaultQuantity,
  brokerages = [],
  initial,
  onSaved,
  variant = "card",
}: {
  defaultTicker?: string;
  defaultBrokerageId?: string;
  defaultKind?: Kind;
  defaultQuantity?: number;
  brokerages?: TransactionFormBrokerage[];
  initial?: TransactionFormInitialValues;
  onSaved?: () => void;
  /** Visual variant: "card" for full panel, "plain" for embedded use inside a modal */
  variant?: "card" | "plain";
}) {
  const editing = initial != null;
  const startingKind: Kind = initial
    ? (initial.kind as Kind)
    : (defaultKind ?? "BUY");

  const toast = useToast();
  const [kind, setKind] = useState<Kind>(startingKind);
  const [ticker, setTicker] = useState(initial?.ticker ?? defaultTicker);
  const [brokerageId, setBrokerageId] = useState<string>(
    initial?.brokerageId ?? defaultBrokerageId ?? (brokerages[0]?.id ?? ""),
  );
  const [currency, setCurrency] = useState<string>(
    initial?.currency ?? brokerages[0]?.currency ?? "CAD",
  );
  const [dividendType, setDividendType] = useState<DividendType | "">(
    initial?.dividendType ?? "",
  );
  const [reasonCode, setReasonCode] = useState<SellReason | "">(
    initial?.reasonCode ?? "",
  );
  const [isDrip, setIsDrip] = useState<boolean>(initial?.isDrip ?? false);
  const [fxRateToCad, setFxRateToCad] = useState<string>(
    initial?.fxRateToCad != null ? String(initial.fxRateToCad) : "",
  );
  const [fxAuto, setFxAuto] = useState<FxLookupActionResult | null>(null);
  const [fxOverride, setFxOverride] = useState<boolean>(
    initial?.fxRateToCad != null,
  );

  // Initialize form fields from initial values when editing
  const [quantity, setQuantity] = useState(() => {
    if (initial) {
      if (initial.kind === "DIVIDEND" || initial.kind === "SPLIT") return "";
      return String(initial.quantity);
    }
    return defaultQuantity != null ? String(defaultQuantity) : "";
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
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [preEntryWarnings, setPreEntryWarnings] = useState<PreEntryWarning[]>([]);

  const selectedBrokerage = brokerages.find((b) => b.id === brokerageId);

  // When the user switches brokerages, reset currency to the new brokerage's
  // default. They can still pick a different currency afterwards (e.g. a
  // USD dividend in a CAD-default brokerage).
  useEffect(() => {
    if (!editing && selectedBrokerage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync of currency to selected brokerage
      setCurrency(selectedBrokerage.currency);
    }
  }, [selectedBrokerage, editing]);

  useEffect(() => {
    if (kind !== "BUY") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale warning when kind changes off BUY
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale room check when kind changes off DEPOSIT
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

  // FX auto-fetch — when the user picks a non-CAD currency we look up the
  // Bank of Canada noon rate at trade date and display it inline. User can
  // tick "override" to type a different rate (e.g. their broker's actual
  // execution rate, which differs slightly from BoC).
  useEffect(() => {
    if (currency === "CAD" || !occurredAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear FX hint when currency goes back to CAD
      setFxAuto(null);
      return;
    }
    if (fxOverride) return; // user is typing their own rate; don't clobber
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await lookupFxRateAction(currency, occurredAt);
        if (cancelled) return;
        setFxAuto(result);
        if (result.ok) setFxRateToCad(String(result.rate));
      } catch {
        if (!cancelled) setFxAuto({ ok: false, error: "Lookup failed." });
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currency, occurredAt, fxOverride]);

  // Pre-submit duplicate check — fires once we have enough context to make
  // a meaningful lookup. Matches by (brokerage, kind, ticker, ±1 day, ±0.1%
  // qty, ±0.5% price). Warning, not blocker.
  useEffect(() => {
    if (!brokerageId || !occurredAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale duplicate list when inputs reset
      setDuplicates([]);
      return;
    }
    // Need at least amount-equivalent fields for the check.
    const isCash = kind === "DEPOSIT" || kind === "WITHDRAWAL";
    let qty: number;
    let p: number;
    if (kind === "BUY" || kind === "SELL") {
      qty = Number(quantity);
      p = Number(price);
    } else if (kind === "DIVIDEND" || isCash) {
      qty = 1;
      p = Number(amount);
    } else {
      setDuplicates([]);
      return;
    }
    if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(p) || p <= 0) {
      setDuplicates([]);
      return;
    }
    const tk = isCash ? null : ticker.trim().toUpperCase();
    if (!isCash && !tk) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkDuplicateTransactionAction({
          brokerageId,
          kind,
          ticker: tk,
          quantity: qty,
          price: p,
          occurredAtIso: occurredAt,
          excludeId: initial?.id,
        });
        if (cancelled) return;
        if (result.ok) setDuplicates(result.matches);
        else setDuplicates([]);
      } catch {
        if (!cancelled) setDuplicates([]);
      }
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [brokerageId, kind, ticker, quantity, price, amount, occurredAt, initial?.id]);

  // Pre-entry guards: TLH-window warning at BUY, panic-sell / active-thesis
  // at SELL. Debounced like the other server-action checks.
  useEffect(() => {
    if (kind !== "BUY" && kind !== "SELL") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale warnings when kind changes off BUY/SELL
      setPreEntryWarnings([]);
      return;
    }
    const tk = ticker.trim().toUpperCase();
    if (!tk || !occurredAt) {
      setPreEntryWarnings([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const qty = kind === "SELL" ? Number(quantity) : undefined;
        const result = await checkPreEntryGuardsAction({
          kind,
          ticker: tk,
          occurredAtIso: occurredAt,
          quantity: Number.isFinite(qty) ? qty : undefined,
        });
        if (cancelled) return;
        setPreEntryWarnings(result.ok ? result.warnings : []);
      } catch {
        if (!cancelled) setPreEntryWarnings([]);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, ticker, occurredAt, quantity]);

  const showShareFields =
    kind === "BUY" || kind === "SELL" || kind === "TRANSFER_IN" || kind === "TRANSFER_OUT";
  const showAmount = kind === "DIVIDEND" || kind === "DEPOSIT" || kind === "WITHDRAWAL";
  const showSplit = kind === "SPLIT";
  const showTicker = kind !== "DEPOSIT" && kind !== "WITHDRAWAL";
  const isCashFlow = kind === "DEPOSIT" || kind === "WITHDRAWAL";
  const isTransfer = kind === "TRANSFER_IN" || kind === "TRANSFER_OUT";
  const showDripCheckbox =
    kind === "BUY" &&
    selectedBrokerage != null &&
    REGISTERED_KINDS_SET.has(selectedBrokerage.kind);

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
    setDividendType("");
    setReasonCode("");
    setIsDrip(false);
    setFxRateToCad("");
    setFxOverride(false);
    setFxAuto(null);
    setDuplicates([]);
    setPreEntryWarnings([]);
    if (selectedBrokerage) setCurrency(selectedBrokerage.currency);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("kind", kind);
    if (brokerageId) fd.set("brokerageId", brokerageId);
    if (currency) fd.set("currency", currency);
    if (kind === "DIVIDEND" && dividendType) fd.set("dividendType", dividendType);
    if (kind === "SELL" && reasonCode) fd.set("reasonCode", reasonCode);
    if (showDripCheckbox && isDrip) fd.set("isDrip", "on");
    // Send fxRateToCad only when user overrode the auto-fetched value. When
    // the override is off, leave the field absent so the server-side
    // resolver fetches fresh from BoC (in case the form's auto-value is
    // stale from earlier debounce).
    if (currency !== "CAD" && fxOverride && fxRateToCad) {
      fd.set("fxRateToCad", fxRateToCad);
    }
    // Cash flows have no ticker.
    if (isCashFlow) fd.delete("ticker");

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
      <div className="mb-6 grid grid-cols-4 gap-1 rounded-[20px] bg-pill p-[5px]">
        {KINDS.map((k) => {
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-[16px] px-1 py-[8px] text-[12px] font-semibold transition-colors ${
                active ? "bg-white text-bg" : "text-muted hover:text-text"
              }`}
            >
              {KIND_LABEL[k]}
            </button>
          );
        })}
      </div>

      {kind === "TRANSFER_IN" ? (
        <div className="mb-3 rounded-[10px] border border-brand/30 bg-brand/10 px-3 py-2.5 text-xs leading-relaxed text-brand-2">
          <div className="text-[13px] font-semibold">Opening / Transfer in</div>
          <div className="mt-1">
            Use this to record a position you already held before any other
            ledger entry — e.g. shares older than your broker&apos;s 15-month
            export window, or stock moved in from another account.{" "}
            <strong>Price = your ACB per share</strong> at the opening date (or
            FMV if it&apos;s a true transfer-in). No realized gain is recorded.
          </div>
        </div>
      ) : null}
      {kind === "TRANSFER_OUT" ? (
        <div className="mb-3 rounded-[10px] border border-muted/30 bg-muted/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <div className="text-[13px] font-semibold">Transfer out</div>
          <div className="mt-1">
            Removes shares without recording a realized gain (use SELL for
            actual dispositions). Price is informational; the position&apos;s
            cost basis travels with the shares to the destination.
          </div>
        </div>
      ) : null}

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

      {/* Currency picker — shown for all kinds; defaults from brokerage but
          overridable for USD dividends/buys held in a CAD-default account. */}
      <Field
        label="Currency"
        help={
          selectedBrokerage && currency !== selectedBrokerage.currency
            ? `Brokerage default is ${selectedBrokerage.currency}; this transaction overrides to ${currency}.`
            : undefined
        }
      >
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={inputClass}
        >
          {Array.from(new Set([
            ...(selectedBrokerage ? [selectedBrokerage.currency] : []),
            ...COMMON_CURRENCIES,
          ])).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      {currency !== "CAD" ? (
        <div className="mb-3 rounded-[10px] border border-border bg-bg/40 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-text">CAD equivalent</span>
            <button
              type="button"
              onClick={() => setFxOverride((v) => !v)}
              className="text-[11px] font-semibold uppercase tracking-wide text-brand hover:underline"
            >
              {fxOverride ? "Use BoC rate" : "Override"}
            </button>
          </div>
          {fxOverride ? (
            <div className="mt-2">
              <input
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="0"
                value={fxRateToCad}
                onChange={(e) => setFxRateToCad(e.target.value)}
                placeholder="1.3742"
                className={inputClass}
              />
              <div className="mt-1 text-muted-2">
                e.g. your broker&apos;s actual execution rate. CAD = 1 {currency} × rate.
              </div>
            </div>
          ) : fxAuto?.ok ? (
            <div className="mt-1">
              BoC rate: <span className="font-mono text-text">{fxAuto.rate.toFixed(4)}</span>{" "}
              {currency}/CAD on{" "}
              <span className="font-mono">{fxAuto.asOf}</span>
              {fxAuto.source === "CACHE" ? (
                <span className="ml-1 text-muted-2">(cached)</span>
              ) : null}
            </div>
          ) : fxAuto && !fxAuto.ok ? (
            <div className="mt-1 text-warning">
              Couldn&apos;t fetch BoC rate ({fxAuto.error}). Tap Override to enter one manually.
            </div>
          ) : (
            <div className="mt-1 text-muted-2">Looking up Bank of Canada rate…</div>
          )}
        </div>
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
          {showDripCheckbox ? (
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-bg/40 px-3 py-2.5 text-xs leading-relaxed text-muted hover:border-border-strong">
              <input
                type="checkbox"
                checked={isDrip}
                onChange={(e) => setIsDrip(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                <span className="text-[13px] font-semibold text-text">
                  Dividend reinvestment (DRIP)
                </span>
                <span className="mt-0.5 block text-muted-2">
                  These shares were bought with a dividend paid inside this
                  {" "}
                  {selectedBrokerage?.kind} — doesn&apos;t consume new contribution
                  room.
                </span>
              </span>
            </label>
          ) : null}
          {kind === "SELL" ? (
            <Field
              label="Reason"
              help="Tells the coach when to stay quiet (rebalance, harvest) vs flag a possible mistake."
            >
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as SellReason | "")}
                className={inputClass}
                required
              >
                <option value="">— Select —</option>
                {SELL_REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} — {o.hint}
                  </option>
                ))}
              </select>
            </Field>
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

      {kind === "DIVIDEND" ? (
        <Field
          label="Dividend type"
          help="Drives which tax rate the after-tax math uses and which T5 box this amount goes to."
        >
          <select
            value={dividendType}
            onChange={(e) => setDividendType(e.target.value as DividendType | "")}
            className={inputClass}
            required
          >
            <option value="">— Select —</option>
            {DIVIDEND_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.hint}
              </option>
            ))}
          </select>
        </Field>
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

      {preEntryWarnings.length > 0 ? (
        <div className="mb-3 space-y-2">
          {preEntryWarnings.map((w, i) => (
            <div
              key={`${w.kind}-${i}`}
              className={`rounded-[10px] border px-3 py-2.5 text-xs leading-relaxed ${
                w.severity === "danger"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-warning/40 bg-warning/10 text-warning"
              }`}
            >
              <div className="text-[13px] font-semibold">{w.title}</div>
              <div className="mt-1">{w.detail}</div>
            </div>
          ))}
        </div>
      ) : null}

      {!editing && duplicates.length > 0 ? (
        <div className="mb-3 rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning">
          <div className="text-[13px] font-semibold">
            Possible duplicate{duplicates.length > 1 ? "s" : ""}
          </div>
          <div className="mt-1 text-warning/90">
            {duplicates.length === 1 ? "An existing transaction matches" : `${duplicates.length} existing transactions match`}
            {" "}closely. Submit anyway only if this is a separate trade.
          </div>
          <ul className="mt-2 space-y-1 text-warning/80">
            {duplicates.map((d) => (
              <li key={d.id} className="font-mono text-[11px]">
                {KIND_LABEL[d.kind as Kind] ?? d.kind} · {d.ticker ?? "cash"} ·{" "}
                {d.quantity > 0 ? `${d.quantity} @ ` : ""}
                {formatCurrency(d.price)} · {d.brokerageName} ·{" "}
                {new Date(d.occurredAt).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
