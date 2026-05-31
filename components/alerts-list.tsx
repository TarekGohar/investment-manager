"use client";

import { useState, useTransition } from "react";
import {
  deleteAlertAction,
  runAlertsNowAction,
  toggleAlertAction,
} from "@/app/actions/alerts";
import { useToast } from "@/components/toast-provider";
import { RULE_LABEL, SCOPE_LABEL } from "@/lib/signals/types";
import type { AlertListItem } from "@/lib/signals/queries";

function timeAgo(d: Date | null): string {
  if (!d) return "Never";
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function AlertsList({ alerts }: { alerts: AlertListItem[] }) {
  return (
    <div className="rounded-card border border-border bg-panel">
      <div className="flex items-center justify-between px-4 py-5 md:px-6">
        <h2 className="text-[16px] font-semibold">Active alerts</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {alerts.length} rule{alerts.length === 1 ? "" : "s"}
          </span>
          <RunNowButton />
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="border-t border-border px-6 py-10 text-center text-sm text-muted">
          No alerts yet — add one below.
        </div>
      ) : (
        alerts.map((a) => <Row key={a.id} alert={a} />)
      )}
    </div>
  );
}

function Row({ alert }: { alert: AlertListItem }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const threshold =
    typeof alert.params.thresholdPct === "number" ? alert.params.thresholdPct : undefined;

  const target =
    alert.scope === "TICKER" && alert.ticker
      ? alert.ticker
      : alert.scope === "PORTFOLIO"
        ? "Portfolio"
        : "All holdings";

  function toggle() {
    startTransition(async () => {
      const result = await toggleAlertAction(alert.id);
      if (!result.ok) {
        toast({ title: "Couldn't toggle", description: result.error, variant: "error" });
      }
    });
  }

  function remove() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    startTransition(async () => {
      const result = await deleteAlertAction(alert.id);
      if (result.ok) {
        toast({ title: "Alert deleted", variant: "success" });
      } else {
        toast({ title: "Couldn't delete", description: result.error, variant: "error" });
        setConfirming(false);
      }
    });
  }

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border px-4 py-4 md:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] font-semibold text-text">
            {RULE_LABEL[alert.rule]}
          </span>
          <span className="text-xs text-muted">
            {SCOPE_LABEL[alert.scope]} · {target}
            {threshold != null ? ` · ${threshold}%` : ""}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>Fired {alert.firedCount}×</span>
          <span>·</span>
          <span>Last: {timeAgo(alert.lastFiredAt)}</span>
          {alert.channels.includes("EMAIL") ? (
            <>
              <span>·</span>
              <span>Email</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${
            alert.enabled ? "bg-brand" : "bg-pill"
          } disabled:opacity-50`}
          aria-label={alert.enabled ? "Disable alert" : "Enable alert"}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
              alert.enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className={`rounded-[10px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
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

function RunNowButton() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await runAlertsNowAction();
      if (!result.ok) {
        toast({ title: "Couldn't run alerts", description: result.error, variant: "error" });
        return;
      }
      toast({
        title:
          result.data.fired === 0
            ? "No new alerts fired"
            : `${result.data.fired} alert${result.data.fired === 1 ? "" : "s"} fired`,
        variant: result.data.fired > 0 ? "success" : "info",
      });
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-bg px-3 text-[12px] font-semibold text-text transition-colors hover:bg-panel-2 disabled:opacity-60"
    >
      {pending ? "Running…" : "Run now"}
    </button>
  );
}
