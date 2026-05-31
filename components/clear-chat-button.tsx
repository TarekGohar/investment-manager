"use client";

import { useState, useTransition } from "react";
import { clearChatAction } from "@/app/actions/chat";

export function ClearChatButton({
  scope,
  disabled,
}: {
  scope: string;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (disabled || pending) return;
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    startTransition(async () => {
      await clearChatAction(scope);
      setConfirming(false);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        confirming
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-border bg-panel text-muted hover:bg-panel-2 hover:text-text"
      }`}
    >
      {pending
        ? "Clearing…"
        : confirming
          ? "Click again to clear"
          : "Clear chat"}
    </button>
  );
}
