import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/pdf,*/*;q=0.8",
};

/** Hard cap on returned text so a single PDF can't blow up the model's context. */
const CHAR_BUDGET = 36_000;

export type PdfReadResult = {
  url: string;
  pageCount: number;
  /** Length of the condensed text BEFORE truncation, so the caller knows what was dropped. */
  sourceChars: number;
  truncated: boolean;
  text: string;
};

/**
 * Fetch a PDF URL and return its condensed text. Returns null on fetch error
 * or when the URL doesn't resolve to a PDF. Condensation aims at token
 * efficiency: collapses whitespace, drops page-number noise, dedupes
 * repeating header/footer lines.
 */
export async function fetchPdfText(url: string): Promise<PdfReadResult | null> {
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const looksLikePdf =
      contentType.includes("pdf") || url.toLowerCase().split("?")[0].endsWith(".pdf");
    if (!looksLikePdf) return null;
    buffer = await res.arrayBuffer();
  } catch {
    return null;
  }

  let pageCount = 0;
  let rawText = "";
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    pageCount = pdf.numPages;
    const extracted = await extractText(pdf, { mergePages: true });
    rawText = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
  } catch {
    return null;
  }

  const condensed = condense(rawText);
  const truncated = condensed.length > CHAR_BUDGET;
  return {
    url,
    pageCount,
    sourceChars: condensed.length,
    truncated,
    text: truncated ? condensed.slice(0, CHAR_BUDGET) : condensed,
  };
}

/**
 * Token-efficient text cleanup:
 *   • Normalize line endings, trim each line.
 *   • Drop standalone page numbers ("3", "Page 3 of 200") and blank-page tags.
 *   • Drop lines that are just punctuation or <3 chars after trimming.
 *   • Dedupe consecutive identical lines (kills repeating headers/footers).
 *   • Collapse runs of spaces/tabs to single space.
 *   • Collapse 3+ blank lines to a single blank line.
 */
function condense(s: string): string {
  const lines = s.replace(/\r\n?/g, "\n").split("\n");
  const cleaned: string[] = [];
  let prev = "";
  for (const raw of lines) {
    let line = raw
      .replace(/[ \t]+/g, " ")
      // Collapse table leader-dot runs ("1990 . . . . . . 84.6 31.7" → "1990 84.6 31.7").
      .replace(/(?:\s*\.){4,}\s*/g, " ")
      // Collapse long dash / underscore separator lines into a single dash.
      .replace(/[-_]{6,}/g, "—")
      .trim();
    if (!line) {
      // Preserve a single blank between paragraphs.
      if (prev !== "") cleaned.push("");
      prev = "";
      continue;
    }
    if (/^Page \d+ of \d+$/i.test(line)) continue;
    if (/^\d{1,4}$/.test(line)) continue; // standalone page numbers
    if (/^[\p{P}\s]+$/u.test(line)) continue; // punctuation-only
    if (line.length < 3) continue;
    if (/^This page intentionally left blank\.?$/i.test(line)) continue;
    if (line === prev) continue; // dedupe consecutive repeats (running headers)
    cleaned.push(line);
    prev = line;
  }
  // Collapse any 3+ blank runs that survived the per-line pass.
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
