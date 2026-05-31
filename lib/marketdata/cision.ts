import "server-only";

/**
 * Cision Newswire (newswire.ca) client.
 *
 * The dominant Canadian press-release wire — most TSX, TSXV, and CSE
 * issuers publish material change reports, quarterly results, dividend
 * announcements, and other disclosures via Cision *simultaneously* with
 * filing them on SEDAR+. Since SEDAR+ is autonomously inaccessible (see
 * lib/filings/sedar-plus.ts), Cision is our practical surface for
 * Canadian small/mid-cap material news.
 *
 * Per-company pages live at `https://www.newswire.ca/news/<slug>/` and
 * embed the 25 most-recent releases inline (no auth, no bot manager).
 * Each release detail page has the full press release text plus
 * JSON-LD with ISO date.
 *
 * Slug resolution: best-effort derivation from the issuer name (drop
 * common corporate suffixes, kebab-case). Users can override via the
 * TickerListing.cisionSlug field when Cision uses an unexpected alias.
 */

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Drop common corporate suffixes + abbreviations before slugifying. */
const SUFFIX_RE =
  /\s+(inc|incorporated|corp|corporation|ltd|limited|llc|holdings|company|co|class\s+[a-z]|class\s+\d|sa|nv|ag|plc|trust|reit|fund|ulc|llp|lp)\.?$/i;

export function cisionDeriveSlug(name: string): string {
  let n = name.trim();
  // Strip multiple trailing suffixes (e.g. "Foo Holdings Inc.")
  for (let i = 0; i < 3; i++) {
    const before = n;
    n = n.replace(SUFFIX_RE, "").trim();
    if (n === before) break;
  }
  return n
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export type CisionRelease = {
  url: string;
  headline: string;
  publishedAt: Date | null;
  /** Short preview drawn from the listing card (~150 chars). */
  preview: string | null;
};

/**
 * Fetch the 25 most-recent press releases for a Cision slug. Returns []
 * if Cision returns 404 (slug doesn't resolve) or if no releases are
 * present.
 */
export async function cisionListReleases(
  slug: string,
  opts: { limit?: number } = {},
): Promise<CisionRelease[]> {
  if (!slug) return [];
  try {
    const res = await fetch(`https://www.newswire.ca/news/${encodeURIComponent(slug)}/`, {
      headers: COMMON_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseCisionListing(html, opts.limit ?? 25);
  } catch (err) {
    console.warn(`[cision] list ${slug}:`, (err as Error).message);
    return [];
  }
}

function parseCisionListing(html: string, limit: number): CisionRelease[] {
  // Press release URL shape: /news-releases/<slug-with-words>-<digits 6-12>.html
  // We match the entire <a>…</a> block and extract:
  //   - URL from href
  //   - Headline from the embedded <img alt="...">  (Cision's clean copy)
  //   - Date + preview from the visible text content
  const linkRegex =
    /<a[^>]*href="(\/news-releases\/[a-z][a-z0-9-]+-\d{6,12}\.html)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = new Set<string>();
  const out: CisionRelease[] = [];

  for (const m of html.matchAll(linkRegex)) {
    const url = `https://www.newswire.ca${m[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const inner = m[2];

    // Clean headline from <img alt="...">  (Cision uses this consistently)
    const altMatch =
      inner.match(/<img[^>]+alt="([^"]+)"/i) ??
      inner.match(/<img[^>]+title="([^"]+)"/i);
    let headline = altMatch
      ? altMatch[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim()
      : "";
    // Cap to a sane headline length, trimming at last word boundary.
    if (headline.length > 220) {
      const cut = headline.slice(0, 220);
      const lastSpace = cut.lastIndexOf(" ");
      headline = (lastSpace > 100 ? cut.slice(0, lastSpace) : cut) + "…";
    }

    // Visible text — used for date + preview
    const rawText = inner
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    const dateMatch = rawText.match(
      /^([A-Z][a-z]{2,8})\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}:\d{2}\s+(?:AM|PM|ET))/,
    );
    let publishedAt: Date | null = null;
    let bodyText = rawText;
    if (dateMatch) {
      publishedAt = parseCisionDate(dateMatch[1], dateMatch[2], dateMatch[3], dateMatch[4]);
      bodyText = rawText.slice(dateMatch[0].length).trim();
    }

    // Fallback: if no img alt, derive headline from the leading visible text
    if (!headline) {
      headline =
        bodyText.split(/(?<=[.?!])\s+(?=[A-Z])/)[0]?.slice(0, 220) || bodyText.slice(0, 220);
    }
    if (!headline) continue;

    // Preview = whatever comes after the headline in the visible text
    let preview: string | null = null;
    const headIdx = bodyText.toLowerCase().indexOf(headline.toLowerCase().slice(0, 40));
    if (headIdx >= 0) {
      const after = bodyText.slice(headIdx + headline.length).trim();
      if (after.length > 20) preview = after.slice(0, 220);
    }

    out.push({ url, headline, publishedAt, preview });
    if (out.length >= limit) break;
  }
  return out;
}

function parseCisionDate(
  monthName: string,
  day: string,
  year: string,
  timeStr: string,
): Date | null {
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const mIdx = months[monthName.slice(0, 3) as keyof typeof months];
  if (mIdx == null) return null;
  // Time is in ET; convert to UTC by adding 4 hours (DST-naive — accurate
  // enough for press-release ordering, which is what we need).
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
  const hr = timeMatch ? Number(timeMatch[1]) : 0;
  const min = timeMatch ? Number(timeMatch[2]) : 0;
  const utc = Date.UTC(Number(year), mIdx, Number(day), hr + 4, min);
  return new Date(utc);
}

/**
 * Fetch the full body of a Cision press release for AI consumption.
 * Returns null if the page can't be fetched.
 */
export async function cisionFetchReleaseBody(url: string): Promise<{
  title: string;
  publishedAt: Date | null;
  body: string;
} | null> {
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = (titleMatch?.[1] ?? "")
      .replace(/\s*\|\s*Cision\s*$/i, "")
      .trim();

    // Date from JSON-LD when available
    let publishedAt: Date | null = null;
    const jsonLd = html.match(
      /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (jsonLd) {
      try {
        const parsed = JSON.parse(jsonLd[1]);
        if (parsed.datePublished) publishedAt = new Date(parsed.datePublished);
      } catch {}
    }

    // Article body
    const articleMatch = html.match(/<article[\s\S]*?<\/article>/);
    const body = (articleMatch?.[0] ?? html)
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return { title, publishedAt, body };
  } catch (err) {
    console.warn(`[cision] body ${url}:`, (err as Error).message);
    return null;
  }
}
