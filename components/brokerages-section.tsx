"use client";

import { useState, useTransition } from "react";
import {
  createBrokerageAction,
  deleteBrokerageAction,
  renameBrokerageAction,
} from "@/app/actions/brokerages";
import { useToast } from "@/components/toast-provider";

export type BrokerageRow = {
  id: string;
  name: string;
  currency: string;
  createdAt: Date;
  transactionCount: number;
};

const inputClass =
  "w-full rounded-[10px] border border-border bg-bg px-3 py-2 text-[14px] outline-none transition-colors placeholder:text-muted-2 focus:border-brand";

export function BrokeragesSection({ brokerages }: { brokerages: BrokerageRow[] }) {
  return (
    <div className="space-y-3">
      {brokerages.length === 0 ? (
        <div className="text-sm text-muted">
          You haven&apos;t recorded any transactions yet — your first will create a default
          brokerage automatically. You can also add one manually below.
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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(brokerage.name);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function startEdit() {
    setName(brokerage.name);
    setEditing(true);
  }

  function cancelEdit() {
    setName(brokerage.name);
    setEditing(false);
  }

  function saveEdit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === brokerage.name) {
      cancelEdit();
      return;
    }
    startTransition(async () => {
      const result = await renameBrokerageAction(brokerage.id, trimmed);
      if (result.ok) {
        toast({ title: "Brokerage renamed", variant: "success" });
        setEditing(false);
      } else {
        toast({ title: "Couldn't rename", description: result.error, variant: "error" });
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

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-bg/40 px-3 py-2.5 sm:flex-row sm:items-center">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit();
            if (e.key === "Escape") cancelEdit();
          }}
          autoFocus
          maxLength={48}
          className={inputClass}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveEdit}
            disabled={pending}
            className="rounded-[10px] bg-gradient-to-r from-brand to-brand-3 px-3 py-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={pending}
            className="rounded-[10px] px-3 py-2 text-[13px] font-semibold text-muted hover:bg-panel-2 hover:text-text"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-[10px] bg-bg/40 px-3 py-2.5">
      <div>
        <div className="text-[14px] font-semibold">{brokerage.name}</div>
        <div className="text-xs text-muted">
          {brokerage.currency} · {brokerage.transactionCount} transaction
          {brokerage.transactionCount === 1 ? "" : "s"} · created{" "}
          {brokerage.createdAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={startEdit}
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
      </div>
    </div>
  );
}

function AddBrokerage() {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const fd = new FormData();
    fd.set("name", trimmed);
    fd.set("currency", "USD");
    startTransition(async () => {
      const result = await createBrokerageAction(fd);
      if (result.ok) {
        toast({ title: "Brokerage added", variant: "success" });
        setName("");
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
    <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-bg/40 px-3 py-2.5 sm:flex-row sm:items-center">
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
        placeholder="Wealthsimple RRSP"
        autoFocus
        maxLength={48}
        className={inputClass}
      />
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
