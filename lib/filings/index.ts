import "server-only";
import { prisma } from "@/lib/prisma";
import type { FilingType } from "@/generated/prisma";
import { lookupCik, listRecentFilings as listEdgarFilings, listForm4Filings, parseForm4, type Form4Transaction } from "./edgar";
import { cseGetFilings, cseCategoryToFilingType } from "@/lib/marketdata/cse";
import { tmxGetCompanyFilings, type TmxCompanyFiling } from "@/lib/marketdata/tmx";

/**
 * Unified filing data adapter.
 *
 * Maps a ticker to the right data source(s) automatically:
 *   - US-listed (EDGAR CIK exists)  → SEC EDGAR (full text + summaries)
 *   - CSE-listed (.CN, TickerListing has cseIssuerId) → webapi.thecse.com
 *     full PDFs
 *   - TSX / TSXV (.TO / .V)  → TMX Money for filing list metadata
 *     (PDFs require SEDAR+ which is Playwright-gated)
 *
 * Consumers (Filings tab, AI tools, quarterly summary cron) call these
 * unified functions without caring about the source.
 */

export type UnifiedFiling = {
  source: "EDGAR" | "CSE" | "TMX";
  type: FilingType;
  /** Human-friendly title (e.g. "10-Q", "Annual MD&A", "Material change report") */
  title: string;
  /** Filing category / description from the source. */
  categoryLabel: string | null;
  filedAt: Date;
  /** Direct URL to the filing document, when available. */
  url: string | null;
  /** Source-specific external ID (accession number, etc.). */
  externalId: string | null;
};

/**
 * Get every filing available across configured sources for a ticker.
 * Sorted newest first.
 */
export async function getFilingsForTicker(
  ticker: string,
  opts: { sinceDays?: number; maxPerSource?: number } = {},
): Promise<UnifiedFiling[]> {
  const sinceMs = opts.sinceDays ? Date.now() - opts.sinceDays * 86_400_000 : 0;
  const since = sinceMs ? new Date(sinceMs) : undefined;
  const limit = opts.maxPerSource ?? 40;
  const sym = ticker.toUpperCase();
  const out: UnifiedFiling[] = [];

  const listing = await prisma.tickerListing.findUnique({ where: { ticker: sym } });

  // 1. EDGAR — try always (resolveCik handles non-US gracefully by returning null)
  const cik = listing?.cik ?? (await lookupCik(sym))?.cik ?? null;
  if (cik) {
    const items = await listEdgarFilings(sym, { since });
    for (const i of items) {
      out.push({
        source: "EDGAR",
        type: i.type,
        title: i.rawForm,
        categoryLabel: null,
        filedAt: i.filedAt,
        url: i.url,
        externalId: i.accessionNumber,
      });
    }
  }

  // 2. CSE — only if listing has cseIssuerId
  if (listing?.cseIssuerId) {
    const filings = await cseGetFilings(listing.cseIssuerId);
    if (filings) {
      for (const f of filings.list.slice(0, limit)) {
        const filedAt = new Date(f.publicDate + "T00:00:00Z");
        if (sinceMs && filedAt.getTime() < sinceMs) continue;
        out.push({
          source: "CSE",
          type: cseCategoryToFilingType(f.documentCategory),
          title: humaniseCseCategory(f.documentCategory),
          categoryLabel: f.filingDescription ?? f.documentDescription,
          filedAt,
          url: f.url,
          externalId: f.accessionNumber,
        });
      }
    }
  }

  // 3. TMX — only for TSX/TSXV when EDGAR didn't already cover it
  const isCanadianListed = /\.(TO|V|NE)$/.test(sym);
  if (isCanadianListed && !cik) {
    const filings = await tmxGetCompanyFilings(sym);
    for (const f of filings.slice(0, limit)) {
      const filedAt = new Date(f.filingDate + "T00:00:00Z");
      if (sinceMs && filedAt.getTime() < sinceMs) continue;
      out.push({
        source: "TMX",
        type: tmxFilingToType(f),
        title: f.name,
        categoryLabel: f.description,
        filedAt,
        url: null,
        externalId: null,
      });
    }
  }

  return out.sort((a, b) => b.filedAt.getTime() - a.filedAt.getTime());
}

export type UnifiedInsiderTransaction = Form4Transaction & {
  source: "EDGAR";
  ticker: string;
};

/**
 * Insider activity for a ticker. US-only for now via EDGAR Form 4;
 * Canadian SEDI / canadianinsider.com is a future addition.
 */
export async function getInsiderActivity(
  ticker: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<UnifiedInsiderTransaction[]> {
  const sym = ticker.toUpperCase();
  const cik = (
    await prisma.tickerListing.findUnique({ where: { ticker: sym } })
  )?.cik ?? (await lookupCik(sym))?.cik ?? null;
  if (!cik) return [];

  const since = opts.sinceDays ? new Date(Date.now() - opts.sinceDays * 86_400_000) : undefined;
  const filings = await listForm4Filings(sym, { since, limit: opts.limit ?? 20 });

  const all: UnifiedInsiderTransaction[] = [];
  for (const f of filings) {
    try {
      const txns = await parseForm4(f);
      for (const t of txns) all.push({ ...t, source: "EDGAR", ticker: sym });
    } catch {
      // Skip silently — parsing edge cases shouldn't break the list
    }
  }
  // Sort by transaction date desc
  all.sort((a, b) => b.transactionDate.getTime() - a.transactionDate.getTime());
  return all;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function humaniseCseCategory(cat: string): string {
  // CSE uses raw enum-style codes. Make them human-readable.
  const map: Record<string, string> = {
    MATERIAL_CHANGE_REPORT: "Material change report",
    NEWS_RELEASES: "News release",
    ANNUAL_FINANCIAL_STATEMENTS: "Annual financial statements",
    INTERIM_FINANCIAL_STATEMENTSREPORT: "Interim financial statements",
    ANNUAL_MDA: "Annual MD&A",
    INTERIM_MDA: "Interim MD&A",
    ANNUAL_CERTIFICATES_NI_52109: "Annual NI 52-109 certificates",
    INTERIM_CERTIFICATES_NI_52109: "Interim NI 52-109 certificates",
    MANAGEMENT_PROXY_MATERIALS: "Management proxy materials",
    NOTICE_OF_THE_MEETING_AND_RECORD_DATE: "Meeting notice",
    REPORT_OF_EXEMPT_DISTRIBUTION_NI_45106: "Exempt distribution (NI 45-106)",
    CHANGE_OF_AUDITOR_FILINGS: "Change of auditor",
    PARTICIPATION_FEE_FORM: "Participation fee form",
  };
  return map[cat] ?? cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function tmxFilingToType(f: TmxCompanyFiling): FilingType {
  const blob = `${f.name} ${f.description ?? ""}`.toLowerCase();
  if (blob.includes("annual md&a") || blob.includes("annual mda")) return "MD_AND_A";
  if (blob.includes("md&a") || blob.includes("interim mda")) return "MD_AND_A";
  if (blob.includes("annual financial statements")) return "ANNUAL_FINANCIAL_STATEMENTS";
  if (blob.includes("interim financial statements")) return "INTERIM_FINANCIAL_STATEMENTS";
  if (blob.includes("annual information form")) return "ANNUAL_INFO_FORM";
  if (blob.includes("material change")) return "MATERIAL_CHANGE_REPORT";
  return "OTHER";
}
