"use client";

import { useState, useTransition } from "react";
import {
  createBrokerageAction,
  deleteBrokerageAction,
  renameBrokerageAction,
  setBrokerageKindAction,
} from "@/app/actions/brokerages";
import { useToast } from "@/components/toast-provider";
import type { BrokerageKind } from "@/generated/prisma";

export type BrokerageRow = {
  id: string;
  name: string;
  kind: BrokerageKind;
  currency: string;
  createdAt: Date;
  transactionCount: number;
};

const KIND_OPTIONS: { value: BrokerageKind; label: string; hint: string }[] = [
  {
    value: "NON_REGISTERED",
    label: "Non-registered",
    hint: "Taxable cash/margin account — ACB tracked, capital gains taxed",
  },
  {
    value: "JOINT_NON_REGISTERED",
    label: "Joint non-registered",
    hint: "Joint taxable account — your half pools into the ACB",
  },
  { value: "TFSA", label: "TFSA", hint: "Tax-free; growth and withdrawals untaxed" },
  { value: "RRSP", label: "RRSP", hint: "Tax-deductible contributions; taxed on withdrawal" },
  {
    value: "FHSA",
    label: "FHSA",
    hint: "First Home Savings — deductible in, tax-free out for first home",
  },
  { value: "RESP", label: "RESP", hint: "Education savings (per beneficiary)" },
  { value: "LIRA", label: "LIRA", hint: "Locked-in retirement account (former employer)" },
  { value: "RRIF", label: "RRIF", hint: "Registered retirement income fund" },
  { value: "CORPORATE", label: "Corporate", hint: "CCPC investment account (advanced)" },
];

const KIND_LABEL: Record<BrokerageKind, string> = Object.fromEntries(
  KIND_OPTIONS.map((k) => [k.value, k.label]),
) as Record<BrokerageKind, string>;

function kindBadgeClass(kind: BrokerageKind): string {
  if (kind === "NON_REGISTERED" || kind === "JOINT_NON_REGISTERED") {
    return "bg-warning/15 text-warning";
  }
  if (kind === "TFSA" || kind === "FHSA") return "bg-success/15 text-success";
  if (kind === "RRSP" || kind === "LIRA" || kind === "RRIF") return "bg-brand/15 text-brand-2";
  if (kind === "RESP") return "bg-brand-3/15 text-brand-3";
  return "bg-muted/15 text-muted";
}

const inputClass =
  "w-full rounded-[10px] border border-border bg-bg px-3 py-2 text-[14px] outline-none transition-colors placeholder:text-muted-2 focus:border-brand";

export function BrokeragesSection({ brokerages }: { brokerages: BrokerageRow[] }) {
  return (
    <div className="space-y-3">
      {brokerages.length === 0 ? (
        <div className="text-sm text-muted">
          You haven&apos;t recorded any transactions yet — your first will create a default
          Non-registered brokerage automatically. You can also add one manually below.
        </div>
      ) : (
        <div className="space-y-2">
          {brokerages.map((b) => (
            <BrokerageRowEditor key={b.id} brokerage={b} />
          ))}
        </div>
      )}
      <AddBrokerage />
    </div>
  );
}

function BrokerageRowEditor({ brokerage }: { brokerage: BrokerageRow }) {
  const toast = useToast();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(brokerage.name);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function startEditName() {
    setName(brokerage.name);
    setEditingName(true);
  }

  function cancelEditName() {
    setName(brokerage.name);
    setEditingName(false);
  }

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === brokerage.name) {
      cancelEditName();
      return;
    }
    startTransition(async () => {
      const result = await renameBrokerageAction(brokerage.id, trimmed);
      if (result.ok) {
        toast({ title: "Brokerage renamed", variant: "success" });
        setEditingName(false);
      } else {
        toast({ title: "Couldn't rename", description: result.error, variant: "error" });
      }
    });
  }

  function changeKind(next: BrokerageKind) {
    if (next === brokerage.kind) return;
    startTransition(async () => {
      const result = await setBrokerageKindAction(brokerage.id, next);
      if (result.ok) {
        toast({
          title: `Account type set to ${KIND_LABEL[next]}`,
          variant: "success",
        });
      } else {
        toast({
          title: "Couldn't change account type",
          description: result.error,
          variant: "error",
        });
      }
    });
  }

  function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    startTransition(async () => {
      const result = await deleteBrokerageAction(brokerage.id);
      if (result.ok) {
        toast({ title: "Brokerage deleted", variant: "success" });
      } else {
        toast({ title: "Couldn't delete", description: result.error, variant: "error" });
        setConfirming(false);
      }
    });
  }

  return (
    <div className="rounded-[10px] bg-bg/40 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editingName ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") cancelEditName();
              }}
              autoFocus
              maxLength={48}
              className={inputClass}
            />
            <button
              type="button"
              onClick={saveName}
              disabled={pending}
              className="rounded-[10px] bg-gradient-to-r from-brand to-brand-3 px-3 py-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancelEditName}
              disabled={pending}
              className="rounded-[10px] px-3 py-2 text-[13px] font-semibold text-muted hover:bg-panel-2 hover:text-text"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{brokerage.name}</span>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${kindBadgeClass(
                brokerage.kind,
              )}`}
            >
              {KIND_LABEL[brokerage.kind]}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {!editingName ? (
            <>
              <button
                type="button"
                onClick={startEditName}
                disabled={pending}
                className="rounded-[10px] px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-panel-2 hover:text-text"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className={`rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  confirming
                    ? "bg-danger/15 text-danger"
                    : "text-muted hover:bg-panel-2 hover:text-danger"
                }`}
              >
                {confirming ? "Confirm" : "Delete"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <span className="font-medium">Account type:</span>
          <select
            value={brokerage.kind}
            onChange={(e) => changeKind(e.target.value as BrokerageKind)}
            disabled={pending}
            className="rounded-[8px] border border-border bg-bg px-2 py-1 text-[12px] outline-none focus:border-brand"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-2">
          {brokerage.currency} · {brokerage.transactionCount} transaction
          {brokerage.transactionCount === 1 ? "" : "s"} · created{" "}
          {brokerage.createdAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>

      {KIND_OPTIONS.find((o) => o.value === brokerage.kind)?.hint ? (
        <div className="mt-1 text-xs text-muted-2">
          {KIND_OPTIONS.find((o) => o.value === brokerage.kind)!.hint}
        </div>
      ) : null}
    </div>
  );
}

function AddBrokerage() {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<BrokerageKind>("NON_REGISTERED");
  const [currency, setCurrency] = useState("CAD");
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const fd = new FormData();
    fd.set("name", trimmed);
    fd.set("kind", kind);
    fd.set("currency", currency);
    startTransition(async () => {
      const result = await createBrokerageAction(fd);
      if (result.ok) {
        toast({ title: "Brokerage added", variant: "success" });
        setName("");
        setKind("NON_REGISTERED");
        setCurrency("CAD");
        setAdding(false);
      } else {
        toast({ title: "Couldn't add", description: result.error, variant: "error" });
      }
    });
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="text-sm font-semibold text-brand-2 hover:underline"
      >
        + Add brokerage
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-border bg-bg/40 px-3 py-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setName("");
            setAdding(false);
          }
        }}
        placeholder="Wealthsimple TFSA"
        autoFocus
        maxLength={48}
        className={inputClass}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <span className="font-medium">Type:</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as BrokerageKind)}
            className="rounded-[8px] border border-border bg-bg px-2 py-1 text-[12px] outline-none focus:border-brand"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <span className="font-medium">Currency:</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="rounded-[8px] border border-border bg-bg px-2 py-1 text-[12px] outline-none focus:border-brand"
          >
            <option value="CAD">CAD</option>
            <option value="USD">USD</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="rounded-[10px] bg-gradient-to-r from-brand to-brand-3 px-3 py-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setName("");
            setAdding(false);
          }}
          disabled={pending}
          className="rounded-[10px] px-3 py-2 text-[13px] font-semibold text-muted hover:bg-panel-2 hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
