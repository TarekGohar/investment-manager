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
 * SEDAR+ has no stable public deep-link for issuer search AND its hosting
 * (Radware ShieldSquare / validate.perfdrive.com) bounces cross-origin
 * sessions to a bot challenge. Even the bare homepage URL fails when
 * clicked from a third-party app because the user arrives without the
 * right TLS / cookie fingerprint. We surface the hostname as plain text
 * and ask the user to type it themselves.
 */
const SEDAR_HOMEPAGE = "sedarplus.ca";

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
