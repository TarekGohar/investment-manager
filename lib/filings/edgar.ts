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
  // SEC requires a User-Agent identifying the requester. They actively
  // 403 strings that look obviously fake (e.g. @example.invalid), so the
  // fallback uses example.com (IANA-reserved, well-formed). Production
  // should override with a real contact via the EDGAR_USER_AGENT env var.
  return (
    process.env.EDGAR_USER_AGENT ||
    "InvestmentManager admin@example.com"
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
  // US domestic issuers
  "10-K": "TEN_K",
  "10-K/A": "TEN_K",
  "10-Q": "TEN_Q",
  "10-Q/A": "TEN_Q",
  "8-K": "EIGHT_K",
  "8-K/A": "EIGHT_K",
  // Canadian foreign private issuers (MJDS) — most Canadian large-caps
  // cross-listed in the US file these instead of 10-K/Q. SHOP, RY, TD,
  // ENB, BMO, MFC, CNQ, BNS, BCE, CP, NTR, TRP, SU, etc.
  "40-F": "FORTY_F",
  "40-F/A": "FORTY_F",
  "6-K": "SIX_K",
  "6-K/A": "SIX_K",
  "20-F": "TWENTY_F",
  "20-F/A": "TWENTY_F",
  "F-10": "F_10",
  "F-10/A": "F_10",
  "F-10EF": "F_10",
  "F-X": "F_X",
  "F-X/A": "F_X",
  "F-3": "F_3",
  "F-3/A": "F_3",
  "F-3DPOS": "F_3",
};

/** Default form set for `listRecentFilings`. Includes both US and Canadian
 *  foreign-issuer periodic + material event filings. */
const DEFAULT_FORMS = [
  "10-K", "10-Q", "8-K",            // US
  "40-F", "6-K", "20-F",            // Canadian annual + material
] as const;

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
 * List recent filings for an issuer. Defaults to US periodic forms
 * (10-K / 10-Q / 8-K) AND Canadian foreign-issuer equivalents (40-F /
 * 6-K / 20-F). The fan-out is automatic; if the issuer files no
 * Canadian forms, that subset just returns empty.
 *
 * MJDS background: Canadian companies cross-listed on US exchanges use
 * the SEC's Multijurisdictional Disclosure System. Instead of 10-K
 * they file 40-F (or 20-F); instead of 10-Q + 8-K they file 6-K. So
 * for SHOP, RY, ENB, etc., these forms ARE the equivalent of what
 * SEDAR+ would otherwise gate.
 */
export async function listRecentFilings(
  ticker: string,
  opts: { since?: Date; forms?: string[] } = {},
): Promise<EdgarFilingListItem[]> {
  const meta = await lookupCik(ticker);
  if (!meta) return [];

  const url = `${EDGAR_BASE}/submissions/CIK${meta.cik}.json`;
  const res = await edgarFetch(url);
  const json = (await res.json()) as SubmissionsResponse;

  const recent = json.filings?.recent;
  if (!recent) return [];

  const allowed = new Set(opts.forms ?? Array.from(DEFAULT_FORMS));
  const since = opts.since?.getTime() ?? 0;
  const items: EdgarFilingListItem[] = [];

  const n = recent.accessionNumber.length;
  for (let i = 0; i < n; i++) {
    const rawForm = recent.form[i];
    // Match exact forms OR amendments (e.g. "40-F/A" matches "40-F")
    const baseForm = rawForm.replace(/\/A$/, "").replace(/EF$/, "").replace(/DPOS$/, "");
    if (!allowed.has(rawForm) && !allowed.has(baseForm)) continue;
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
      type: FORM_MAP[rawForm] ?? FORM_MAP[baseForm] ?? "OTHER",
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

// ─── Form 4 (insider transactions) ─────────────────────────────────────

export type Form4Transaction = {
  insiderName: string;
  insiderTitle: string | null;
  /** "A" (acquired / buy) or "D" (disposed / sell), or null if not in standard codes. */
  acquiredOrDisposed: "A" | "D" | null;
  /** P (purchase), S (sale), M (option exercise), G (gift), etc. */
  transactionCode: string | null;
  transactionDate: Date;
  shares: number | null;
  pricePerShare: number | null;
  sharesOwnedAfter: number | null;
  /** True for "direct" beneficial ownership, false for indirect. */
  directOwnership: boolean | null;
  filingUrl: string;
  accessionNumber: string;
};

export type Form4Filing = {
  accessionNumber: string;
  filedAt: Date;
  url: string;
  /** Primary doc HTML/XML URL. Used to fetch the structured XML. */
  primaryDocument: string;
};

/** List Form 4 filings for a ticker. */
export async function listForm4Filings(
  ticker: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<Form4Filing[]> {
  const meta = await lookupCik(ticker);
  if (!meta) return [];
  const url = `${EDGAR_BASE}/submissions/CIK${meta.cik}.json`;
  const res = await edgarFetch(url);
  const json = (await res.json()) as SubmissionsResponse;
  const recent = json.filings?.recent;
  if (!recent) return [];
  const since = opts.since?.getTime() ?? 0;
  const limit = opts.limit ?? 50;
  const items: Form4Filing[] = [];
  for (let i = 0; i < recent.accessionNumber.length && items.length < limit; i++) {
    if (recent.form[i] !== "4" && recent.form[i] !== "4/A") continue;
    const filedAt = new Date(recent.filingDate[i] + "T00:00:00Z");
    if (filedAt.getTime() < since) continue;
    const accessionNumber = recent.accessionNumber[i];
    const accessionNoDash = accessionNumber.replace(/-/g, "");
    const primaryDocument = recent.primaryDocument[i];
    const cikNum = Number(meta.cik);
    items.push({
      accessionNumber,
      filedAt,
      primaryDocument,
      url: `${EDGAR_WWW}/Archives/edgar/data/${cikNum}/${accessionNoDash}/${primaryDocument}`,
    });
  }
  return items;
}

/**
 * Fetch and parse a Form 4 filing. The primary document is usually XML
 * (form4.xml) or an HTML wrapper. We grab the underlying ownership.xml
 * and extract reporter info + non-derivative transaction rows.
 */
export async function parseForm4(filing: Form4Filing): Promise<Form4Transaction[]> {
  // Find the XML companion. EDGAR archive folders typically contain
  // form4.xml or wf-form4_*.xml. The accession archive index lists them.
  const accessionNoDash = filing.accessionNumber.replace(/-/g, "");
  const cikFromUrl = filing.url.match(/data\/(\d+)\//)?.[1];
  if (!cikFromUrl) return [];
  const indexUrl = `${EDGAR_WWW}/Archives/edgar/data/${cikFromUrl}/${accessionNoDash}/index.json`;
  let xmlName: string | null = null;
  try {
    const idxRes = await fetch(indexUrl, {
      headers: { "User-Agent": userAgent() },
      cache: "no-store",
    });
    if (idxRes.ok) {
      const idx = (await idxRes.json()) as { directory?: { item?: Array<{ name: string }> } };
      for (const item of idx.directory?.item ?? []) {
        if (/\.xml$/i.test(item.name) && /form4|ownership|wf-form4/i.test(item.name)) {
          xmlName = item.name;
          break;
        }
      }
      // Fall back: any .xml in the dir
      if (!xmlName) {
        for (const item of idx.directory?.item ?? []) {
          if (/\.xml$/i.test(item.name) && !/-index\.xml$/i.test(item.name)) {
            xmlName = item.name;
            break;
          }
        }
      }
    }
  } catch {}
  if (!xmlName) return [];

  const xmlUrl = `${EDGAR_WWW}/Archives/edgar/data/${cikFromUrl}/${accessionNoDash}/${xmlName}`;
  const xmlRes = await fetch(xmlUrl, {
    headers: { "User-Agent": userAgent() },
    cache: "no-store",
  });
  if (!xmlRes.ok) return [];
  const xml = await xmlRes.text();

  // Insider name + title
  const insiderName =
    extract(xml, /<reportingOwnerId>[\s\S]*?<rptOwnerName>(.*?)<\/rptOwnerName>/i) ?? "Unknown";
  const titles: string[] = [];
  for (const m of xml.matchAll(/<officerTitle>([^<]+)<\/officerTitle>/gi)) titles.push(m[1].trim());
  const isDirector = /<isDirector>\s*(?:1|true)\s*<\/isDirector>/i.test(xml);
  const isOfficer = /<isOfficer>\s*(?:1|true)\s*<\/isOfficer>/i.test(xml);
  const isTenPercentOwner = /<isTenPercentOwner>\s*(?:1|true)\s*<\/isTenPercentOwner>/i.test(xml);
  const insiderTitle =
    titles.join(", ") ||
    [isDirector && "Director", isOfficer && "Officer", isTenPercentOwner && "10% Owner"]
      .filter(Boolean)
      .join(", ") ||
    null;

  const txns: Form4Transaction[] = [];
  // Walk every <nonDerivativeTransaction>
  for (const block of xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)) {
    const inner = block[1];
    const txDate = extract(inner, /<transactionDate>[\s\S]*?<value>(.*?)<\/value>/i);
    const code = extract(inner, /<transactionCode>(.*?)<\/transactionCode>/i);
    const ad = extract(inner, /<transactionAcquiredDisposedCode>[\s\S]*?<value>(.*?)<\/value>/i);
    const shares = extract(inner, /<transactionShares>[\s\S]*?<value>(.*?)<\/value>/i);
    const price = extract(inner, /<transactionPricePerShare>[\s\S]*?<value>(.*?)<\/value>/i);
    const sharesAfter = extract(inner, /<sharesOwnedFollowingTransaction>[\s\S]*?<value>(.*?)<\/value>/i);
    const ownership = extract(inner, /<directOrIndirectOwnership>[\s\S]*?<value>(.*?)<\/value>/i);
    if (!txDate) continue;
    txns.push({
      insiderName: insiderName.trim(),
      insiderTitle,
      acquiredOrDisposed: ad === "A" ? "A" : ad === "D" ? "D" : null,
      transactionCode: code?.trim() ?? null,
      transactionDate: new Date(txDate + "T00:00:00Z"),
      shares: shares ? Number(shares) : null,
      pricePerShare: price ? Number(price) : null,
      sharesOwnedAfter: sharesAfter ? Number(sharesAfter) : null,
      directOwnership: ownership === "D" ? true : ownership === "I" ? false : null,
      filingUrl: filing.url,
      accessionNumber: filing.accessionNumber,
    });
  }
  return txns;
}

function extract(xml: string, re: RegExp): string | null {
  const m = xml.match(re);
  return m ? m[1] : null;
}

// ─── HTML → text helpers ───────────────────────────────────────────────

function htmlToText(html: string): string {
  const stripped = html
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

  return skipXbrlHeader(stripped);
}

/**
 * Inline-XBRL 10-Q / 10-K HTML embeds a long block of context refs, taxonomy
 * URLs, and concept tags at the top of the document before the actual
 * rendered narrative. We skip to the first marker that reliably indicates
 * "real prose starts here" — falling back to the full text if none of the
 * markers are found (don't want to nuke short filings).
 */
function skipXbrlHeader(text: string): string {
  const markers = [
    "UNITED STATES SECURITIES AND EXCHANGE COMMISSION",
    "United States Securities and Exchange Commission",
    "FORM 10-Q",
    "FORM 10-K",
    "Form 10-Q",
    "Form 10-K",
    "QUARTERLY REPORT",
    "ANNUAL REPORT",
    "PART I",
  ];
  let bestIndex = -1;
  for (const m of markers) {
    const i = text.indexOf(m);
    if (i >= 0 && (bestIndex === -1 || i < bestIndex)) {
      bestIndex = i;
    }
  }
  // Only skip if the marker is more than ~500 chars in (otherwise we'd be
  // skipping past a short, already-clean preamble).
  if (bestIndex > 500) return text.slice(bestIndex);
  return text;
}
