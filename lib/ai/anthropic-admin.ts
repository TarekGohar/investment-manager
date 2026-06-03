import "server-only";

/**
 * Anthropic Admin API client — returns the *actual* billed usage and cost
 * for the organization, straight from the source. Sidesteps the inferred
 * spend that the rest of the app computes from token counts × pricing.
 *
 * Requires an Admin API key (format `sk-ant-admin01-...`), distinct from
 * the regular `sk-ant-api...` key used for inference. Generate one in the
 * Anthropic console → Settings → Admin Keys. Set as ANTHROPIC_ADMIN_KEY
 * in env. If unset, the Usage tab falls back to our token-based estimate.
 *
 * Endpoints:
 *   - /v1/organizations/cost_report          — USD spend by day + line item
 *   - /v1/organizations/usage_report/messages — token volume by model / workspace
 *
 * Docs (live, may need WebFetch for the latest field shape):
 *   https://platform.claude.com/docs/en/api/admin-api
 */

const ANTHROPIC_API = "https://api.anthropic.com";

export type AnthropicCostReportItem = {
  /** Discriminator from Anthropic — e.g. `uncached_input_tokens`, `output_tokens`, `cache_read_input_tokens`. */
  cost_type: string;
  /** USD amount as a string (Anthropic returns money as decimal strings). */
  amount: string;
  /** Optional grouping context (model name, workspace, etc.). */
  context?: Record<string, unknown>;
};

export type AnthropicCostReportBucket = {
  /** ISO 8601 start of the bucket window. */
  starting_at: string;
  /** ISO 8601 end of the bucket window. */
  ending_at: string;
  /** Per-cost-type breakdown for the bucket. */
  results: AnthropicCostReportItem[];
};

export type AnthropicCostReportResponse = {
  data: AnthropicCostReportBucket[];
  has_more: boolean;
  next_page?: string | null;
};

/**
 * True iff ANTHROPIC_ADMIN_KEY is set. Use to gate UI that depends on the
 * Admin API — there's no point rendering the "Anthropic billed" tile if we
 * have nothing to show.
 */
export function adminApiConfigured(): boolean {
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  return Boolean(key && key.startsWith("sk-ant-admin"));
}

/**
 * Cost report for a window. Defaults to month-to-date.
 *
 * Returns null when ANTHROPIC_ADMIN_KEY isn't set OR the request fails.
 * Callers should fall through to the token-based estimate in that case;
 * surface the error in dev via console only — don't break the UI over a
 * billing-data fetch.
 */
export async function fetchCostReport(opts: {
  startingAt?: Date;
  endingAt?: Date;
  signal?: AbortSignal;
} = {}): Promise<AnthropicCostReportResponse | null> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!adminKey) return null;

  const now = new Date();
  const startingAt =
    opts.startingAt ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const params = new URLSearchParams({
    starting_at: startingAt.toISOString(),
  });
  if (opts.endingAt) params.set("ending_at", opts.endingAt.toISOString());

  try {
    const res = await fetch(
      `${ANTHROPIC_API}/v1/organizations/cost_report?${params.toString()}`,
      {
        headers: {
          "x-api-key": adminKey,
          "anthropic-version": "2023-06-01",
        },
        signal: opts.signal,
        // Anthropic billing data updates every few hours; cache for 5 min so
        // a single page load doesn't fan out to multiple admin calls.
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) {
      console.warn(`[anthropic-admin] cost_report ${res.status}: ${await res.text()}`);
      return null;
    }
    return (await res.json()) as AnthropicCostReportResponse;
  } catch (err) {
    console.warn(`[anthropic-admin] cost_report fetch failed:`, err);
    return null;
  }
}

/**
 * Sum every bucket × every line item into a single USD figure. Anthropic
 * already returns the cost in the line item's natural currency (USD), so
 * we just parse the decimal strings and add.
 */
export function sumCostReport(report: AnthropicCostReportResponse): number {
  let total = 0;
  for (const bucket of report.data) {
    for (const item of bucket.results) {
      const n = Number.parseFloat(item.amount);
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}

/**
 * Group line items by `cost_type` for a "what categories drove the spend"
 * breakdown. Returns highest-cost first.
 */
export function groupCostByType(
  report: AnthropicCostReportResponse,
): Array<{ costType: string; amountUsd: number }> {
  const totals = new Map<string, number>();
  for (const bucket of report.data) {
    for (const item of bucket.results) {
      const n = Number.parseFloat(item.amount);
      if (!Number.isFinite(n)) continue;
      totals.set(item.cost_type, (totals.get(item.cost_type) ?? 0) + n);
    }
  }
  return Array.from(totals.entries())
    .map(([costType, amountUsd]) => ({ costType, amountUsd }))
    .sort((a, b) => b.amountUsd - a.amountUsd);
}
