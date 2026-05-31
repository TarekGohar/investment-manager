import "server-only";
import type { FilingType } from "@/generated/prisma";

/**
 * SEC EDGAR client. Free, no API key required, but SEC asks for a
 * descriptive User-Agent header so they can contact you if you misbehave.
 * Set EDGAR_USER_AGENT to something like
 *   "Investment Manager <you@example.com>"
 * Falls back to the user's email + repo name if unset.
 */
const EDGAR_BASE = "https://data.sec.gov";
const EDGAR_WWW = "https://www.sec.gov";

function userAgent(): string {
  return (
    process.env.EDGAR_USER_AGENT ||
    "InvestmentManager (contact-via-github+claude-code@example.invalid)"
  );
}

async function edgarFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent(),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`EDGAR ${res.status} on ${url}`);
  }
  return res;
}

type CompanyTicker = {
  cik_str: number;
  ticker: string;
  title: string;
};

/** SEC publishes a 12k-row JSON mapping ticker → CIK. Cached at module level. */
let companyTickersCache: Map<string, { cik: string; title: string }> | null = null;
let companyTickersFetchedAt = 0;
const COMPANY_TICKERS_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

async function loadCompanyTickers(): Promise<Map<string, { cik: string; title: string }>> {
  const now = Date.now();
  if (companyTickersCache && now - companyTickersFetchedAt < COMPANY_TICKERS_TTL_MS) {
    return companyTickersCache;
  }
  const res = await edgarFetch(`${EDGAR_WWW}/files/company_tickers.json`);
  const raw = (await res.json()) as Record<string, CompanyTicker>;
  const map = new Map<string, { cik: string; title: string }>();
  for (const entry of Object.values(raw)) {
    map.set(entry.ticker.toUpperCase(), {
      cik: String(entry.cik_str).padStart(10, "0"),
      title: entry.title,
    });
  }
  companyTickersCache = map;
  companyTickersFetchedAt = now;
  return map;
}

export async function lookupCik(
  ticker: string,
): Promise<{ cik: string; title: string } | null> {
  const map = await loadCompanyTickers();
  return map.get(ticker.toUpperCase()) ?? null;
}

export type EdgarFilingListItem = {
  accessionNumber: string;
  type: FilingType;
  rawForm: string;
  primaryDocument: string;
  filedAt: Date;
  reportDate: Date | null;
  url: string;
};

const FORM_MAP: Record<string, FilingType> = {
  "10-K": "TEN_K",
  "10-K/A": "TEN_K",
  "10-Q": "TEN_Q",
  "10-Q/A": "TEN_Q",
  "8-K": "EIGHT_K",
  "8-K/A": "EIGHT_K",
};

type SubmissionsResponse = {
  cik: string;
  filings?: {
    recent?: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      reportDate: string[];
      primaryDocument: string[];
    };
  };
};

/**
 * List recent filings for an issuer. Filters to 10-K / 10-Q / 8-K by default
 * — those are the most material for thesis tracking.
 */
export async function listRecentFilings(
  ticker: string,
  opts: { since?: Date; forms?: Array<"10-K" | "10-Q" | "8-K"> } = {},
): Promise<EdgarFilingListItem[]> {
  const meta = await lookupCik(ticker);
  if (!meta) return [];

  const url = `${EDGAR_BASE}/submissions/CIK${meta.cik}.json`;
  const res = await edgarFetch(url);
  const json = (await res.json()) as SubmissionsResponse;

  const recent = json.filings?.recent;
  if (!recent) return [];

  const allowed = new Set(opts.forms ?? ["10-K", "10-Q", "8-K"]);
  const since = opts.since?.getTime() ?? 0;
  const items: EdgarFilingListItem[] = [];

  const n = recent.accessionNumber.length;
  for (let i = 0; i < n; i++) {
    const rawForm = recent.form[i];
    if (!allowed.has(rawForm as "10-K" | "10-Q" | "8-K") && !rawForm.startsWith("10-K") && !rawForm.startsWith("10-Q") && !rawForm.startsWith("8-K")) {
      continue;
    }
    if (!allowed.has(rawForm as "10-K" | "10-Q" | "8-K")) continue;
    const filedAt = new Date(recent.filingDate[i] + "T00:00:00Z");
    if (filedAt.getTime() < since) continue;
    const accessionNumber = recent.accessionNumber[i];
    const accessionNoDash = accessionNumber.replace(/-/g, "");
    const primaryDocument = recent.primaryDocument[i];
    const cikNum = Number(meta.cik);
    const docUrl = `${EDGAR_WWW}/Archives/edgar/data/${cikNum}/${accessionNoDash}/${primaryDocument}`;
    const reportDate = recent.reportDate[i]
      ? new Date(recent.reportDate[i] + "T00:00:00Z")
      : null;

    items.push({
      accessionNumber,
      type: FORM_MAP[rawForm] ?? "OTHER",
      rawForm,
      primaryDocument,
      filedAt,
      reportDate,
      url: docUrl,
    });
  }

  return items;
}

/**
 * Fetch the primary document of a filing and extract plaintext. EDGAR filings
 * are huge HTML documents — we strip tags, drop scripts/styles, collapse
 * whitespace, and truncate. Far from production-grade, but good enough to
 * feed to an LLM with a sensible token budget.
 */
export async function fetchFilingText(
  url: string,
  opts: { maxChars?: number } = {},
): Promise<string> {
  const maxChars = opts.maxChars ?? 240_000; // ~60k tokens, leaving headroom for prompt
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`EDGAR doc ${res.status} on ${url}`);
  const html = await res.text();
  return htmlToText(html).slice(0, maxChars);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
