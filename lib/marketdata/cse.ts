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
  // Accept any of:
  //   https://thecse.com/en/listings/<sector>/<company-slug>
  //   https://thecse.com/listings/<company-slug>/
  //   https://thecse.com/en/listings/<company-slug>
  //   "<sector>/<company-slug>"
  //   "<company-slug>"
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

    // Extract slug from whichever URL form. We accept either:
    //   /en/listings/<sector>/<company-slug>  (canonical)
    //   /en/listings/<company-slug>           (CSE accepts this redirect)
    //   /listings/<company-slug>              (the form CSE auto-redirects from)
    const finalUrl = new URL(res.url || url);
    const segments = finalUrl.pathname.split("/").filter((s) => s && s !== "en" && s !== "listings");
    const slug = segments.join("/") || pp.slug || "";

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

export type CseQuote = {
  symbol: string;
  name: string;
  lastPrice: number | null;
  prevClose: number | null;
  netChange: number | null;
  netChangePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  tradeCount: number | null;
  tradingValueCad: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  asOf: Date;
};

/**
 * Fetch live quote + bid/ask for a CSE-listed issuer by scraping its
 * listing page. The Next.js data blob contains structured quote fields.
 *
 * `slug` is the path segment after `/en/listings/`, e.g.
 * `"life-sciences/mountain-valley-md-holdings-inc"`. Stored on
 * TickerListing.cseSlug after the user pastes the URL once.
 */
export async function cseGetQuote(slug: string): Promise<CseQuote | null> {
  if (!slug) return null;
  try {
    const res = await fetch(`https://thecse.com/en/listings/${slug.replace(/^\/+/, "")}`, {
      headers: COMMON_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const pp = data.props?.pageProps;
    const scd = pp?.staticCompanyData;
    if (!scd) return null;

    const consolidated = scd.consolidated?.ticker as Record<string, number | string> | undefined;
    const quote = scd.quote as Record<string, number | string> | undefined;
    const md = scd.metadata as Record<string, string> | undefined;
    const updatedAt = scd.updated_at as { date?: string; time?: string } | undefined;
    if (!consolidated && !quote) return null;

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v)
        ? v
        : typeof v === "string" && !isNaN(Number(v))
          ? Number(v)
          : null;

    return {
      symbol: pp.symbol ?? md?.symbol ?? "",
      name: md?.security_name ?? pp.title ?? pp.symbol ?? "",
      lastPrice: num(consolidated?.["Last Price"]),
      prevClose: num(consolidated?.["Previous Closing Price"]),
      netChange: num(consolidated?.["Net Change"]),
      netChangePct: num(consolidated?.["Net Change Percentage"]),
      dayHigh: num(consolidated?.["Days High Price"]),
      dayLow: num(consolidated?.["Days Low Price"]),
      volume: num(consolidated?.["Trading Volume"]),
      tradeCount: num(consolidated?.["Trade Count"]),
      tradingValueCad: num(consolidated?.["Trading Value (CAD)"]),
      bidPrice: num(quote?.["Bid Price"]),
      askPrice: num(quote?.["Ask Price"]),
      bidSize: num(quote?.["Bid Size"]),
      askSize: num(quote?.["Ask Size"]),
      asOf:
        updatedAt?.date && updatedAt?.time
          ? new Date(`${updatedAt.date}T${updatedAt.time}-04:00`)
          : new Date(),
    };
  } catch (err) {
    console.error(`[cse] getQuote failed for ${slug}:`, (err as Error).message);
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
