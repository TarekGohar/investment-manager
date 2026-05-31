import "server-only";

/**
 * TMX Money GraphQL client (app-money.tmx.com).
 *
 * Public, unauthenticated. Used to enrich TSX / TSXV / Aequitas / NEO
 * listings with quote, news, filing list, and corporate actions data that
 * Yahoo / Finnhub don't reliably cover for Canadian-listed names.
 *
 * Discovered schema (introspection is disabled on this server — fields
 * below were learned from "Did you mean" error hints):
 *   Query.getQuoteBySymbol(symbol, locale)
 *   Query.getNewsForSymbol(symbol!, locale!, page!, limit!)
 *   Query.getCompanyFilings(symbol)
 *   Query.getInsiderTransactions(symbol)
 *   Query.getDividendsForSymbol, getSplitsForSymbol, getEarningsForSymbol
 */

const TMX_GRAPHQL = "https://app-money.tmx.com/graphql";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
};

async function gqlPost<T>(operationName: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(TMX_GRAPHQL, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify({ operationName, query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`TMX GraphQL ${res.status} on ${operationName}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length) {
    throw new Error(`TMX GraphQL error on ${operationName}: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error(`TMX GraphQL empty data on ${operationName}`);
  return json.data;
}

/**
 * Convert app-internal ticker to TMX symbol. TMX uses the raw symbol
 * without exchange suffixes (e.g. "SHOP.TO" → "SHOP"). For TSXV, the same;
 * for some dual classes TMX uses the suffix verbatim.
 */
function toTmxSymbol(ticker: string): string {
  const t = ticker.toUpperCase().trim();
  // Strip exchange suffix if present
  return t.replace(/\.(TO|V|NE|CN)$/, "");
}

export type TmxQuote = {
  symbol: string;
  name: string | null;
  exchangeName: string | null;
  industry: string | null;
  sector: string | null;
  price: number | null;
  priceChange: number | null;
  percentChange: number | null;
  volume: number | null;
  prevClose: number | null;
  dividendYield: number | null;
  dividendFrequency: string | null;
  peRatio: number | null;
  marketCap: number | null;
  marketCapAllClasses: number | null;
  sharesOutstanding: number | null;
  totalSharesOutstanding: number | null;
  averageVolume10D: number | null;
  averageVolume30D: number | null;
  weeks52high: number | null;
  weeks52low: number | null;
};

export async function tmxGetQuote(ticker: string): Promise<TmxQuote | null> {
  const symbol = toTmxSymbol(ticker);
  try {
    const data = await gqlPost<{
      getQuoteBySymbol: TmxQuote & {
        MarketCap?: number | null;
        MarketCapAllClasses?: number | null;
        shareOutStanding?: number | null;
        totalSharesOutStanding?: number | null;
      } | null;
    }>(
      "getQuoteBySymbol",
      `query getQuoteBySymbol($symbol: String, $locale: String) {
        getQuoteBySymbol(symbol: $symbol, locale: $locale) {
          symbol name exchangeName industry sector
          price priceChange percentChange volume prevClose
          dividendYield dividendFrequency
          peRatio MarketCap MarketCapAllClasses
          shareOutStanding totalSharesOutStanding
          averageVolume10D averageVolume30D
          weeks52high weeks52low
        }
      }`,
      { symbol, locale: "en" },
    );
    const q = data.getQuoteBySymbol;
    if (!q) return null;
    return {
      ...q,
      marketCap: q.MarketCap ?? null,
      marketCapAllClasses: q.MarketCapAllClasses ?? null,
      sharesOutstanding: q.shareOutStanding ?? null,
      totalSharesOutstanding: q.totalSharesOutStanding ?? null,
    };
  } catch (err) {
    console.error(`[tmx] getQuote failed for ${ticker}:`, (err as Error).message);
    return null;
  }
}

export type TmxNewsItem = {
  headline: string;
  datetime: string; // ISO
  source: string | null;
};

export async function tmxGetNews(ticker: string, limit = 15): Promise<TmxNewsItem[]> {
  const symbol = toTmxSymbol(ticker);
  try {
    const data = await gqlPost<{ news: TmxNewsItem[] | null }>(
      "getNewsForSymbol",
      `query getNewsForSymbol($symbol: String!, $locale: String!, $page: Int!, $limit: Int!) {
        news: getNewsForSymbol(symbol: $symbol, locale: $locale, page: $page, limit: $limit) {
          headline datetime source
        }
      }`,
      { symbol, locale: "en", page: 1, limit },
    );
    return data.news ?? [];
  } catch (err) {
    console.error(`[tmx] getNews failed for ${ticker}:`, (err as Error).message);
    return [];
  }
}

export type TmxCompanyFiling = {
  filingDate: string; // ISO yyyy-mm-dd
  /** Filing type label (e.g. "Form of proxy", "Annual MD&A") */
  name: string;
  /** Filing category description (e.g. "Management proxy materials") */
  description: string | null;
};

export async function tmxGetCompanyFilings(ticker: string): Promise<TmxCompanyFiling[]> {
  const symbol = toTmxSymbol(ticker);
  try {
    const data = await gqlPost<{ getCompanyFilings: TmxCompanyFiling[] | null }>(
      "getCompanyFilings",
      `query getCompanyFilings($symbol: String!) {
        getCompanyFilings(symbol: $symbol) {
          filingDate name description
        }
      }`,
      { symbol },
    );
    return data.getCompanyFilings ?? [];
  } catch (err) {
    console.error(`[tmx] getCompanyFilings failed for ${ticker}:`, (err as Error).message);
    return [];
  }
}
