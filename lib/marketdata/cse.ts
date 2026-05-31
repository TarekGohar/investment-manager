import "server-only";

/**
 * Canadian Securities Exchange client.
 *
 * CSE re-hosts every SEDAR+ filing for its listed issuers as a direct PDF
 * on `sedar-filings-primary.thecse.com`, and exposes a JSON index at
 * `webapi.thecse.com/trading/listed/sedar_filings/<issuerId>.json`. This
 * bypasses SEDAR+'s Radware bot manager entirely.
 *
 * The catch: we need the CSE issuer ID (a 9-digit zero-padded number,
 * e.g. "000023721"). It's embedded in the Next.js page data on the
 * issuer's CSE listing page but there's no public symbol → issuerId
 * endpoint. We resolve it on first access by fetching
 * `thecse.com/en/listings/<sector>/<slug>` once the slug is known, then
 * cache it in TickerListing.
 *
 * For the slug, the user typically provides the CSE page URL the first
 * time they record a `.CN` ticker. We extract the slug from the URL.
 */

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/html;q=0.9, */*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
};

export type CseFilingRecord = {
  url: string;
  documentDescription: string; // e.g. "MATERIAL_CHANGE_REPORT_EN"
  documentCategory: string; // e.g. "MATERIAL_CHANGE_REPORT"
  documentLanguage: string | null;
  filingDescription: string | null;
  publicDate: string; // ISO yyyy-mm-dd
  accessionNumber: string;
  status: string;
};

export type CseFilingsResponse = {
  categories: Record<string, number>;
  list: CseFilingRecord[];
};

/**
 * Fetch every SEDAR-mirrored filing for a CSE issuer. The endpoint
 * returns ALL historical filings (often hundreds).
 */
export async function cseGetFilings(issuerId: string): Promise<CseFilingsResponse | null> {
  const padded = issuerId.padStart(9, "0");
  try {
    const res = await fetch(
      `https://webapi.thecse.com/trading/listed/sedar_filings/${padded}.json`,
      { headers: COMMON_HEADERS, cache: "no-store" },
    );
    if (!res.ok) {
      console.error(`[cse] filings ${res.status} for issuer ${padded}`);
      return null;
    }
    const json = (await res.json()) as {
      categories?: Record<string, number>;
      list?: Array<{
        url: string;
        document_description: string;
        document_category: string;
        document_language: string | null;
        filing_description: string | null;
        public_date: string;
        accession_number: string;
        status: string;
      }>;
    };
    return {
      categories: json.categories ?? {},
      list: (json.list ?? []).map((r) => ({
        url: r.url,
        documentDescription: r.document_description,
        documentCategory: r.document_category,
        documentLanguage: r.document_language,
        filingDescription: r.filing_description,
        publicDate: r.public_date,
        accessionNumber: r.accession_number,
        status: r.status,
      })),
    };
  } catch (err) {
    console.error(`[cse] getFilings failed for ${issuerId}:`, (err as Error).message);
    return null;
  }
}

export type CseListingMetadata = {
  symbol: string;
  name: string;
  slug: string; // "<sector>/<company-slug>"
  issuerId: string;
  sector: string | null;
  listingDate: string | null;
  outstandingShares: number | null;
  websiteUrl: string | null;
};

/**
 * Given a CSE listing page URL (or slug fragment), fetch the page and
 * extract the issuer ID + canonical metadata. Caller stores in
 * TickerListing for subsequent fast lookups.
 *
 * Examples of accepted inputs:
 *   "https://thecse.com/en/listings/life-sciences/mountain-valley-md-holdings-inc"
 *   "life-sciences/mountain-valley-md-holdings-inc"
 */
export async function cseResolveListing(
  urlOrSlug: string,
): Promise<CseListingMetadata | null> {
  const url = urlOrSlug.startsWith("http")
    ? urlOrSlug
    : `https://thecse.com/en/listings/${urlOrSlug.replace(/^\/+/, "")}`;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const pp = data.props?.pageProps;
    const md = pp?.staticCompanyData?.metadata;
    if (!pp?.symbol || !md?.sedar_filings) return null;
    const issuerIdMatch = String(md.sedar_filings).match(/sedar_filings\/(\d+)\.json/);
    if (!issuerIdMatch) return null;
    // Slug comes from the URL path itself: /en/listings/<sector-slug>/<company-slug>
    const slugMatch = new URL(url).pathname.match(
      /\/en\/listings\/([^/]+)\/([^/?#]+)/,
    );
    const slug = slugMatch ? `${slugMatch[1]}/${slugMatch[2]}` : (pp.slug ?? "");
    return {
      symbol: pp.symbol,
      name: md.security_name ?? pp.title ?? pp.symbol,
      slug,
      issuerId: issuerIdMatch[1],
      sector: md.sector ?? null,
      listingDate: md.listing_date ?? null,
      outstandingShares: md.outstanding_shares ?? null,
      websiteUrl: md.company_website_url ?? null,
    };
  } catch (err) {
    console.error(`[cse] resolveListing failed for ${urlOrSlug}:`, (err as Error).message);
    return null;
  }
}

/**
 * Map our FilingType enum from CSE's document_category. CSE uses
 * SCREAMING_SNAKE_CASE category codes that don't perfectly align with
 * Prisma's FilingType enum — this normalizes them.
 */
export function cseCategoryToFilingType(
  category: string,
): "ANNUAL_FINANCIAL_STATEMENTS" | "INTERIM_FINANCIAL_STATEMENTS" | "MD_AND_A" | "ANNUAL_INFO_FORM" | "MATERIAL_CHANGE_REPORT" | "OTHER" {
  switch (category) {
    case "ANNUAL_FINANCIAL_STATEMENTS":
      return "ANNUAL_FINANCIAL_STATEMENTS";
    case "INTERIM_FINANCIAL_STATEMENTSREPORT":
    case "INTERIM_FINANCIAL_STATEMENTS":
      return "INTERIM_FINANCIAL_STATEMENTS";
    case "ANNUAL_MDA":
    case "INTERIM_MDA":
      return "MD_AND_A";
    case "ANNUAL_INFORMATION_FORM":
      return "ANNUAL_INFO_FORM";
    case "MATERIAL_CHANGE_REPORT":
      return "MATERIAL_CHANGE_REPORT";
    default:
      return "OTHER";
  }
}
