import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

/**
 * User-supplied marginal tax rates. Never guessed — if a value is null,
 * the UI must omit dollar estimates and prompt the user to fill it in.
 * Rates are expressed as decimals (0.5331 = 53.31%).
 */
export type TaxProfile = {
  /** Two-letter Canadian province code, or null. */
  province: string | null;
  marginalOrdinaryRate: number | null;
  marginalCapGainsRate: number | null;
  marginalEligibleDividendRate: number | null;
  marginalNonEligibleDividendRate: number | null;
};

export const EMPTY_TAX_PROFILE: TaxProfile = {
  province: null,
  marginalOrdinaryRate: null,
  marginalCapGainsRate: null,
  marginalEligibleDividendRate: null,
  marginalNonEligibleDividendRate: null,
};

/**
 * Inputs for performance + risk metrics. Never guessed.
 *  - benchmarkTicker drives TWR-vs-benchmark, beta. Common Canadian picks:
 *    VFV.TO (S&P 500 hedged), XSP.TO (S&P 500 CAD-hedged), VEQT.TO (all-equity
 *    Canadian-tilt), SPY (USD S&P 500). The user picks; we do not default.
 *  - riskFreeRate is an *annualized* decimal (e.g. 0.045 = 4.5%). Sharpe etc.
 *    use it directly. User pulls from Bank of Canada 3-mo T-bill or whichever
 *    proxy they prefer.
 */
export type PerformanceProfile = {
  benchmarkTicker: string | null;
  riskFreeRate: number | null;
};

export const EMPTY_PERFORMANCE_PROFILE: PerformanceProfile = {
  benchmarkTicker: null,
  riskFreeRate: null,
};

export type UserPreferences = {
  // ─── AI background jobs ────────────────────────────────────────
  /** Daily review cron will run for this user. */
  aiAutoDailyReview: boolean;
  /** Weekly review cron will run for this user. */
  aiAutoWeeklyReview: boolean;
  /** classify-news cron will run AI severity classification on this user's news. */
  aiNewsClassification: boolean;

  // ─── Notifications ─────────────────────────────────────────────
  /** Global kill-switch for Mailgun alert digest emails. */
  emailDigestEnabled: boolean;
  /**
   * When true (the default), alert digest emails only fire for events the
   * platform classifies as material — today: NEWS_MATERIAL severity
   * MATERIAL/CRITICAL. Future sessions add TLH_OPPORTUNITY,
   * REBALANCE_DUE, THESIS_INVALIDATION_CANDIDATE — all material by
   * design. Low-signal rules (PRICE_MOVE, MA_CROSS, VOLUME_SPIKE,
   * routine DRAWDOWN) still write AlertEvents (visible in /alerts) but
   * stay out of email. Set to false to email every fired event.
   */
  silentUnlessMaterial: boolean;
  /** Whether the topbar bell shows the unread count badge. */
  showNotificationBadge: boolean;
  /** Whether visiting /alerts auto-clears unread events. */
  autoMarkEventsRead: boolean;

  // ─── Position page ─────────────────────────────────────────────
  /** Whether to fetch + render the news section on position pages. */
  fetchPositionNews: boolean;
  /** Whether to fetch + render the fundamentals section on position pages. */
  fetchPositionFundamentals: boolean;

  // ─── Dashboard ─────────────────────────────────────────────────
  /** Whether to render the allocation donut on the dashboard. */
  showAllocationDonut: boolean;

  // ─── Tax profile (user-supplied; no defaults) ──────────────────
  taxProfile: TaxProfile;

  // ─── Performance profile (user-supplied; no defaults) ──────────
  performanceProfile: PerformanceProfile;
};

const DEFAULT_BOOLEAN_PREFERENCES = {
  aiAutoDailyReview: true,
  aiAutoWeeklyReview: true,
  aiNewsClassification: true,
  emailDigestEnabled: true,
  silentUnlessMaterial: true,
  showNotificationBadge: true,
  autoMarkEventsRead: true,
  fetchPositionNews: true,
  fetchPositionFundamentals: true,
  showAllocationDonut: true,
} as const;

export const DEFAULT_PREFERENCES: UserPreferences = {
  ...DEFAULT_BOOLEAN_PREFERENCES,
  taxProfile: { ...EMPTY_TAX_PROFILE },
  performanceProfile: { ...EMPTY_PERFORMANCE_PROFILE },
};

export const BOOLEAN_PREFERENCE_KEYS = Object.keys(
  DEFAULT_BOOLEAN_PREFERENCES,
) as (keyof typeof DEFAULT_BOOLEAN_PREFERENCES)[];

export const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof UserPreferences)[];

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    return mergeWithDefaults((row?.preferences as Partial<UserPreferences> | null) ?? null);
  } catch (err) {
    // Most likely a stale Prisma client without the `preferences` column.
    // Fall back to defaults so the rest of the page still renders.
    console.error("[preferences] read failed, using defaults:", err);
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function setUserPreference<K extends keyof UserPreferences>(
  userId: string,
  key: K,
  value: UserPreferences[K],
): Promise<UserPreferences> {
  const current = await getUserPreferences(userId);
  const next = { ...current, [key]: value };
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export async function setTaxProfile(
  userId: string,
  profile: TaxProfile,
): Promise<UserPreferences> {
  const current = await getUserPreferences(userId);
  const next: UserPreferences = { ...current, taxProfile: { ...profile } };
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export async function setPerformanceProfile(
  userId: string,
  profile: PerformanceProfile,
): Promise<UserPreferences> {
  const current = await getUserPreferences(userId);
  const next: UserPreferences = {
    ...current,
    performanceProfile: { ...profile },
  };
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

function mergeWithDefaults(partial: Partial<UserPreferences> | null): UserPreferences {
  const result: UserPreferences = {
    ...DEFAULT_BOOLEAN_PREFERENCES,
    taxProfile: { ...EMPTY_TAX_PROFILE },
    performanceProfile: { ...EMPTY_PERFORMANCE_PROFILE },
  };
  if (!partial) return result;
  for (const key of BOOLEAN_PREFERENCE_KEYS) {
    const value = partial[key];
    if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  if (partial.taxProfile && typeof partial.taxProfile === "object") {
    result.taxProfile = sanitizeTaxProfile(partial.taxProfile);
  }
  if (
    partial.performanceProfile &&
    typeof partial.performanceProfile === "object"
  ) {
    result.performanceProfile = sanitizePerformanceProfile(partial.performanceProfile);
  }
  return result;
}

function sanitizePerformanceProfile(
  raw: Partial<PerformanceProfile>,
): PerformanceProfile {
  const ticker =
    typeof raw.benchmarkTicker === "string" && raw.benchmarkTicker.trim()
      ? raw.benchmarkTicker.trim().toUpperCase()
      : null;
  const rfr =
    typeof raw.riskFreeRate === "number" &&
    Number.isFinite(raw.riskFreeRate) &&
    raw.riskFreeRate >= 0 &&
    raw.riskFreeRate <= 1
      ? raw.riskFreeRate
      : null;
  return { benchmarkTicker: ticker, riskFreeRate: rfr };
}

function sanitizeTaxProfile(raw: Partial<TaxProfile>): TaxProfile {
  const rate = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v < 0 || v > 1) return null;
    return v;
  };
  return {
    province: typeof raw.province === "string" && raw.province.trim() ? raw.province.trim().toUpperCase() : null,
    marginalOrdinaryRate: rate(raw.marginalOrdinaryRate),
    marginalCapGainsRate: rate(raw.marginalCapGainsRate),
    marginalEligibleDividendRate: rate(raw.marginalEligibleDividendRate),
    marginalNonEligibleDividendRate: rate(raw.marginalNonEligibleDividendRate),
  };
}
