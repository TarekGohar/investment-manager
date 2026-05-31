import type { AlertRule, AlertScope } from "@/generated/prisma";

export type AlertParams = {
  // PRICE_MOVE: |day change %| ≥ thresholdPct → fire
  PRICE_MOVE: { thresholdPct: number };
  // DRAWDOWN: (price - ACB) / ACB * 100 ≤ -thresholdPct → fire
  DRAWDOWN: { thresholdPct: number };
  // CONCENTRATION: any holding's weight ≥ thresholdPct → fire (per ticker)
  CONCENTRATION: { thresholdPct: number };
  // MA_CROSS_50 / MA_CROSS_200: close crosses the moving average (either direction)
  MA_CROSS_50: Record<string, never>;
  MA_CROSS_200: Record<string, never>;
  // VOLUME_SPIKE: today's volume ≥ multipleX × 30-day average
  VOLUME_SPIKE: { multipleX: number };
  // NEWS_MATERIAL: fires when AI classifies recent news as MATERIAL or CRITICAL
  NEWS_MATERIAL: Record<string, never>;
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
  MA_CROSS_50: "50-day MA cross",
  MA_CROSS_200: "200-day MA cross",
  VOLUME_SPIKE: "Volume spike",
  NEWS_MATERIAL: "Material news",
};

export const RULE_DESCRIPTION: Record<AlertRule, string> = {
  PRICE_MOVE: "Day change exceeds a percent threshold (either direction)",
  DRAWDOWN: "Current price is down by at least the threshold vs your avg cost",
  CONCENTRATION: "A single position grows past a percent of total portfolio",
  MA_CROSS_50: "Close crosses the 50-day moving average (either direction)",
  MA_CROSS_200: "Close crosses the 200-day moving average (either direction)",
  VOLUME_SPIKE: "Today's volume exceeds N× the 30-day average",
  NEWS_MATERIAL: "AI classifies a fresh headline as material or critical",
};

export const SCOPE_LABEL: Record<AlertScope, string> = {
  PORTFOLIO: "Whole portfolio",
  HOLDING: "Any held position",
  TICKER: "Specific ticker",
};
