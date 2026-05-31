import "server-only";
import type { FilingType } from "@/generated/prisma";

/**
 * SEDAR+ filings client — stub.
 *
 * SEDAR+ (https://www.sedarplus.ca) is the CSA's filing system for
 * Canadian-listed issuers. It exposes a search UI but no stable public JSON
 * API; the CSA Documents API requires a contractual relationship. Scraping
 * the search results works but is fragile (auth cookies, geo-locked CDN).
 *
 * For now this client returns a deep-link to the issuer's SEDAR+ profile and
 * no filing list. The Filings tab on Canadian-listed positions will show
 * that link plus a note that AI summarization is currently US-listed only.
 *
 * To upgrade later:
 *  - Implement issuer-name lookup by ticker (no clean source — likely TMX
 *    company directory CSV).
 *  - Either accept the CSA API terms, or wire up a scrape of the search
 *    results page with a real browser via Playwright.
 */

const SEDAR_BASE = "https://www.sedarplus.ca";

export type SedarFilingListItem = {
  externalId: string;
  type: FilingType;
  title: string;
  url: string;
  filedAt: Date;
};

export async function listRecentFilings(
  _ticker: string,
  _opts: { since?: Date } = {},
): Promise<SedarFilingListItem[]> {
  // Deep integration deferred. See module header.
  return [];
}

/** Returns a search URL on SEDAR+ for the given ticker symbol or issuer name. */
export function issuerSearchUrl(query: string): string {
  const params = new URLSearchParams({
    keyword: query,
  });
  return `${SEDAR_BASE}/landingpage/?${params.toString()}`;
}
