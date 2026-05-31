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

/**
 * SEDAR+ has no stable public deep-link for issuer search — the search UI
 * is stateful (form POSTs against a session) and synthetic URLs trip the
 * abuse-detection system. We just point users at the homepage and let
 * them paste the ticker into the search box themselves.
 */
const SEDAR_HOMEPAGE = "https://www.sedarplus.ca/landingpage/?language=en_CA";

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

/** Public URL to send users to so they can search SEDAR+ manually. */
export function sedarPlusHomeUrl(): string {
  return SEDAR_HOMEPAGE;
}
