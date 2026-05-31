import "server-only";
import { prisma } from "@/lib/prisma";
import type { FilingType } from "@/generated/prisma";

/**
 * SEDAR+ filings client — **currently inactive**.
 *
 * We tried two approaches and proved both don't work from a server-side
 * Node runtime:
 *
 * 1. Session-cookie replay: paste cookies from a real browser, send them
 *    on subsequent server fetches. → Radware rejects with HTTP 200 +
 *    soft-block page. Tested with multiple Sec-Ch-Ua versions, with and
 *    without Referer, with and without Sec-Fetch headers — same 2875-byte
 *    block page every time. Radware fingerprints the TLS handshake, not
 *    just the HTTP headers.
 *
 * 2. TLS fingerprint impersonation via cycletls: → Radware returns
 *    HTTP 400 with `Server: rdwr` regardless of which Chrome JA3 we use.
 *    They're combining JA3 with HTTP/2 frame fingerprinting and IP
 *    reputation to refuse the request even when TLS handshake matches.
 *
 * The only realistic remaining paths are (a) a Chrome browser extension
 * that runs ON the user's logged-in session, or (b) accepting that SEDAR+
 * isn't autonomously accessible. The helper functions below are kept for
 * future use; nothing currently calls them.
 *
 * The ExternalCookieSession Prisma model + the parseIssuerNumberFromUrl
 * helper still have value for the extension path, so they stay in the
 * schema.
 */

const SEDAR_BASE = "https://www.sedarplus.ca";

export type SedarSession = {
  userId: string;
  cookieHeader: string;
  userAgent: string;
};

export async function getSedarSession(userId: string): Promise<SedarSession | null> {
  const row = await prisma.externalCookieSession.findUnique({
    where: { userId_source: { userId, source: "SEDAR_PLUS" } },
  });
  if (!row) return null;
  return {
    userId,
    cookieHeader: row.cookieHeader,
    userAgent:
      row.userAgent ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
}

/**
 * Extract the Chrome major version from a User-Agent string so we can
 * generate matching Sec-Ch-Ua headers. Radware's bot manager flags
 * sessions where Sec-Ch-Ua version doesn't match the User-Agent.
 */
function chromeVersionFromUserAgent(ua: string): string {
  const m = ua.match(/Chrome\/(\d+)/);
  return m ? m[1] : "131";
}

function platformFromUserAgent(ua: string): string {
  if (/Mac OS X|Macintosh/i.test(ua)) return '"macOS"';
  if (/Windows/i.test(ua)) return '"Windows"';
  if (/Linux/i.test(ua)) return '"Linux"';
  return '"macOS"';
}

/**
 * Server-side fetch using the user's captured SEDAR+ session. Mirrors
 * the exact fingerprint of a real Chrome navigation: Sec-Ch-Ua version
 * matches the User-Agent's Chrome version, Sec-Fetch-Site reflects the
 * navigation context.
 *
 * `init.referer` controls how we present this request to Radware:
 *   - omit / null  → initial page nav, Sec-Fetch-Site: none, no Referer
 *   - string       → in-site nav, Sec-Fetch-Site: same-origin + Referer
 */
export async function sedarFetch(
  session: SedarSession,
  url: string,
  init: RequestInit & { referer?: string | null } = {},
): Promise<Response> {
  const chromeVersion = chromeVersionFromUserAgent(session.userAgent);
  const platform = platformFromUserAgent(session.userAgent);
  const secChUa = `"Chromium";v="${chromeVersion}", "Not_A Brand";v="24", "Google Chrome";v="${chromeVersion}"`;

  const refererProvided = init.referer != null;
  const referer = init.referer;

  const baseHeaders: Record<string, string> = {
    Cookie: session.cookieHeader,
    "User-Agent": session.userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Sec-Ch-Ua": secChUa,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": platform,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Site": refererProvided ? "same-origin" : "none",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
  if (refererProvided && referer) baseHeaders["Referer"] = referer;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { referer: _unused, ...passthrough } = init;

  return fetch(url, {
    ...passthrough,
    headers: {
      ...baseHeaders,
      ...(init.headers ?? {}),
    },
    redirect: "follow",
  });
}

/**
 * Probe whether the saved cookies still work. Hits the SEDAR+ landing
 * page as a fresh nav (Sec-Fetch-Site: none, no Referer) — same shape
 * as what minted the cookies in the user's browser.
 */
export async function testSedarSession(session: SedarSession): Promise<{
  ok: boolean;
  status: number;
  blocked: boolean;
  detail: string;
}> {
  try {
    const res = await sedarFetch(session, `${SEDAR_BASE}/landingpage/?language=en_CA`);
    const text = await res.text();
    const blocked =
      text.includes("__uzdbm_") ||
      text.includes("validate.perfdrive") ||
      text.includes("Your support ID") ||
      text.includes("Radware Captcha") ||
      text.includes("perfdrive.com");

    // Surface a hint about what Radware actually did so we can iterate.
    let hint = "";
    if (blocked) {
      if (text.includes("validate.perfdrive")) hint = " (redirected to validation challenge)";
      else if (text.includes("Your support ID")) hint = " (got the soft-block 'support ID' page)";
      else if (text.includes("Radware Captcha")) hint = " (hCaptcha challenge)";
      else hint = " (anti-bot JS challenge in body)";
    }

    return {
      ok: res.ok && !blocked,
      status: res.status,
      blocked,
      detail: blocked
        ? `Cookies rejected by Radware${hint} — Chrome v${chromeVersionFromUserAgent(session.userAgent)} fingerprint replayed but blocked. Try re-capturing.`
        : res.ok
          ? `OK · HTTP ${res.status} · ${text.length.toLocaleString()} bytes · final URL: ${res.url}`
          : `HTTP ${res.status} · ${text.length} bytes`,
    };
  } catch (err) {
    return { ok: false, status: 0, blocked: false, detail: (err as Error).message };
  }
}

// ─── Issuer profile + filings parsing ──────────────────────────────────

export type SedarIssuerProfile = {
  issuerNo: string;
  name: string | null;
  profileUrl: string;
};

/**
 * Extract the SEDAR+ issuer number from a profile URL the user pasted.
 * Accepts both modern (csa-party) and legacy (cspublic) URL shapes.
 */
export function parseIssuerNumberFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // Try common params: issuerNo, issuer-no, issuerId, partyId
    const candidates = ["issuerNo", "issuer-no", "issuerId", "partyId", "id"];
    for (const k of candidates) {
      const v = u.searchParams.get(k);
      if (v && /^\d+$/.test(v)) return v;
    }
    // Try in the path (e.g. /csa-party/records/issuer/12345)
    const pathMatch = u.pathname.match(/(?:issuer|party|profile)\/?(\d+)/i);
    if (pathMatch) return pathMatch[1];
    return null;
  } catch {
    return null;
  }
}

export type SedarFilingRecord = {
  filedAt: Date;
  type: FilingType;
  title: string;
  documentUrl: string | null;
  externalId: string;
};

/**
 * Fetch the filings list for a given issuer number. The exact URL pattern
 * depends on which SEDAR+ surface we're hitting — this function tries a
 * few known patterns and returns the first successful parse.
 *
 * The actual response is HTML rendered by JSF / PrimeFaces. We extract
 * filing rows by parsing the response DOM (regex-based — light, no JSDOM
 * dependency).
 */
export async function fetchSedarFilingsForIssuer(
  session: SedarSession,
  issuerNo: string,
  opts: { limit?: number } = {},
): Promise<SedarFilingRecord[]> {
  const limit = opts.limit ?? 100;

  // SEDAR+ exposes per-issuer filings at a stable URL pattern. We have
  // two candidates to try because the exact shape has changed since the
  // SEDAR+ launch in July 2023.
  const candidates = [
    `${SEDAR_BASE}/cspublic/issuerFilings?issuerNo=${issuerNo}`,
    `${SEDAR_BASE}/csa-party/records/searchPublicProfile.html?issuerNo=${issuerNo}&searchType=Filing`,
  ];

  for (const url of candidates) {
    try {
      const res = await sedarFetch(session, url);
      if (!res.ok) continue;
      const html = await res.text();
      if (html.includes("validate.perfdrive") || html.includes("Your support ID")) continue;
      const rows = parseFilingsTable(html);
      if (rows.length > 0) return rows.slice(0, limit);
    } catch {
      // Try the next candidate
    }
  }

  return [];
}

/**
 * Parse a SEDAR+ filings table HTML response. Looks for table rows
 * containing a filing date + form type + document link.
 *
 * SEDAR+ wraps filings in `<tr>` elements with classes like `filing-row`
 * or inside data tables. The actual selectors will need refinement once
 * we have a real response captured — this is a best-effort regex parser
 * that handles the common shape.
 */
function parseFilingsTable(html: string): SedarFilingRecord[] {
  const rows: SedarFilingRecord[] = [];
  // Match table rows that contain a date and a filing link
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 2) continue;

    // Look for an ISO-ish date in one of the cells
    const dateMatch = cells.join(" ").match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const filedAt = new Date(dateMatch[1] + "T00:00:00Z");
    if (Number.isNaN(filedAt.getTime())) continue;

    // Find the document link
    const linkMatch = match[0].match(/href="([^"]+(?:\.pdf|document[^"]*))"/i);
    const documentUrl = linkMatch
      ? linkMatch[1].startsWith("http")
        ? linkMatch[1]
        : `${SEDAR_BASE}${linkMatch[1]}`
      : null;

    // Title / description — take the longest cell text
    const cellTexts = cells.map((c) => c.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    const title = cellTexts
      .filter((t) => t.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(t))
      .sort((a, b) => b.length - a.length)[0] ?? "Filing";

    const externalId =
      linkMatch?.[1]?.split(/[/?#]/).pop()?.split(".")[0] ??
      `sedar:${dateMatch[1]}:${title.slice(0, 40)}`;

    rows.push({
      filedAt,
      type: guessFilingType(title),
      title,
      documentUrl,
      externalId,
    });
  }
  return rows;
}

function guessFilingType(title: string): FilingType {
  const t = title.toLowerCase();
  if (t.includes("annual md&a") || t.includes("annual mda")) return "MD_AND_A";
  if (t.includes("md&a") || t.includes("interim mda")) return "MD_AND_A";
  if (t.includes("annual information form")) return "ANNUAL_INFO_FORM";
  if (t.includes("annual financial")) return "ANNUAL_FINANCIAL_STATEMENTS";
  if (t.includes("interim financial")) return "INTERIM_FINANCIAL_STATEMENTS";
  if (t.includes("material change")) return "MATERIAL_CHANGE_REPORT";
  return "OTHER";
}
