"use client";

import { useEffect } from "react";
import {
  TransactionForm,
  type TransactionFormBrokerage,
  type TransactionFormInitialValues,
} from "@/components/transaction-form";

export function EditTransactionModal({
  open,
  initial,
  brokerages,
  onClose,
}: {
  open: boolean;
  initial: TransactionFormInitialValues | null;
  brokerages: TransactionFormBrokerage[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !initial) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md overflow-y-auto rounded-[22px] border border-border bg-panel p-[22px] shadow-2xl max-h-[90vh]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold">Edit transaction</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel-2 hover:text-text"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <TransactionForm
          initial={initial}
          brokerages={brokerages}
          onSaved={onClose}
          variant="plain"
        />
      </div>
    </div>
  );
}
