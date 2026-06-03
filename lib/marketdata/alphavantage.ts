import "server-only";
import type { EarningsTranscript, TranscriptSegment } from "./types";

const BASE_URL = "https://www.alphavantage.co/query";

type AvSegment = {
  speaker?: string;
  title?: string;
  content?: string;
  sentiment?: string | number;
};

type AvResp = {
  symbol?: string;
  quarter?: string;
  transcript?: AvSegment[];
  // Alpha Vantage returns these (HTTP 200) for rate limits / bad inputs.
  Information?: string;
  Note?: string;
  "Error Message"?: string;
};

/**
 * Fetch a single earnings-call transcript from Alpha Vantage's
 * `EARNINGS_CALL_TRANSCRIPT` function. Returns segmented speaker turns with
 * per-segment sentiment. Never throws — transcripts are an optional enrichment,
 * and a missing key / rate-limit / uncovered ticker just yields null.
 *
 * @param quarter Fiscal quarter in `YYYYQ[1-4]` form, e.g. "2024Q1".
 */
export async function fetchEarningsTranscript(
  symbol: string,
  quarter: string,
): Promise<EarningsTranscript | null> {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) {
    console.warn(
      "[marketdata] ALPHAVANTAGE_API_KEY is not set — earnings transcripts disabled",
    );
    return null;
  }

  const sym = symbol.toUpperCase();
  const url = new URL(BASE_URL);
  url.searchParams.set("function", "EARNINGS_CALL_TRANSCRIPT");
  url.searchParams.set("symbol", sym);
  url.searchParams.set("quarter", quarter);
  url.searchParams.set("apikey", key);

  let data: AvResp;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(
        `[marketdata] Alpha Vantage transcript ${res.status} for ${sym} ${quarter}`,
      );
      return null;
    }
    data = (await res.json()) as AvResp;
  } catch (err) {
    console.error(
      `[marketdata] Alpha Vantage transcript fetch failed for ${sym} ${quarter}:`,
      err,
    );
    return null;
  }

  const notice = data.Information ?? data.Note ?? data["Error Message"];
  if (notice) {
    console.warn(
      `[marketdata] Alpha Vantage transcript unavailable for ${sym} ${quarter}: ${notice}`,
    );
    return null;
  }

  const rows = Array.isArray(data.transcript) ? data.transcript : [];
  if (rows.length === 0) return null;

  const segments: TranscriptSegment[] = rows.map((r) => ({
    speaker: r.speaker?.trim() || "Unknown",
    title: r.title?.trim() || "",
    content: (r.content ?? "").trim(),
    sentiment: r.sentiment != null ? String(r.sentiment) : null,
  }));

  return {
    ticker: sym,
    quarter: data.quarter || quarter,
    title: null,
    segments,
    source: "alphavantage",
  };
}
