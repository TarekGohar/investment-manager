import type { AlertRule, AlertScope } from "@/generated/prisma";

export type AlertParams = {
  // PRICE_MOVE: |day change %| ≥ thresholdPct → fire
  PRICE_MOVE: { thresholdPct: number };
  // DRAWDOWN: (price - avgCost) / avgCost * 100 ≤ -thresholdPct → fire
  DRAWDOWN: { thresholdPct: number };
  // CONCENTRATION: any holding's weight ≥ thresholdPct → fire (per ticker)
  CONCENTRATION: { thresholdPct: number };
};

export type AlertChannel = "IN_APP" | "EMAIL";

export type AlertConfig = {
  id: string;
  userId: string;
  rule: AlertRule;
  scope: AlertScope;
  ticker: string | null;
  params: Record<string, unknown>;
  enabled: boolean;
  channels: AlertChannel[];
};

export type FiredEvent = {
  alertId: string;
  userId: string;
  ticker: string | null;
  message: string;
  data: Record<string, unknown>;
};

export function paramsFor<R extends keyof AlertParams>(
  rule: R,
  raw: unknown,
): AlertParams[R] | null {
  if (!raw || typeof raw !== "object") return null;
  switch (rule) {
    case "PRICE_MOVE":
    case "DRAWDOWN":
    case "CONCENTRATION": {
      const t = (raw as Record<string, unknown>).thresholdPct;
      if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
      return { thresholdPct: t } as AlertParams[R];
    }
    default:
      return null;
  }
}

export const RULE_LABEL: Record<AlertRule, string> = {
  PRICE_MOVE: "Price move",
  DRAWDOWN: "Drawdown from cost",
  CONCENTRATION: "Concentration",
};

export const RULE_DESCRIPTION: Record<AlertRule, string> = {
  PRICE_MOVE: "Day change exceeds a percent threshold (either direction)",
  DRAWDOWN: "Current price is down by at least the threshold vs your avg cost",
  CONCENTRATION: "A single position grows past a percent of total portfolio",
};

export const SCOPE_LABEL: Record<AlertScope, string> = {
  PORTFOLIO: "Whole portfolio",
  HOLDING: "Any held position",
  TICKER: "Specific ticker",
};
