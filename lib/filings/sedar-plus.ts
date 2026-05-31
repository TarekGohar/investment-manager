import "server-only";
import { prisma } from "@/lib/prisma";
import type { FilingType } from "@/generated/prisma";

/**
 * SEDAR+ filings client.
 *
 * SEDAR+ is gated by Radware ShieldSquare + hCaptcha. Autonomous scraping
 * is not feasible without paid captcha solvers or stealth-patched headless
 * browsers. Instead this module uses **manual session-cookie reuse**: the
 * user solves the captcha once in their real browser, copies the Cookie
 * header (and User-Agent), and pastes them into the app. We pass those
 * cookies on server-side fetches and the bot manager accepts the session.
 *
 * Cookies typically last days to weeks. When they expire (or SEDAR+
 * rotates them), the user re-captures via DevTools.
 *
 * URL surface used:
 *  - Issuer profile page — user pastes a single URL; we extract the
 *    SEDAR+ project / issuer number from the query string
 *  - Filings list — derived from the issuer profile by following the
 *    page's "View company filings" link (or a known query pattern)
 *  - Document detail / PDF — links extracted from the filings list
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
 * Server-side fetch using the user's captured SEDAR+ session. Sends the
 * stored Cookie header + matching User-Agent + browser-like Sec-Ch-Ua
 * headers, which is enough to satisfy Radware as long as the cookies
 * are fresh.
 */
export async function sedarFetch(
  session: SedarSession,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Cookie: session.cookieHeader,
      "User-Agent": session.userAgent,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua":
        '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      Referer: `${SEDAR_BASE}/landingpage/?language=en_CA`,
      ...(init.headers ?? {}),
    },
    redirect: "follow",
  });
}

/**
 * Probe whether the saved cookies still work. Hits the SEDAR+ landing
 * page and looks for either a successful render or the bot challenge.
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
      text.includes("Radware Captcha");
    return {
      ok: res.ok && !blocked,
      status: res.status,
      blocked,
      detail: blocked
        ? "Cookies rejected by Radware — re-capture from your browser."
        : res.ok
          ? `OK (${text.length} bytes)`
          : `HTTP ${res.status}`,
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
