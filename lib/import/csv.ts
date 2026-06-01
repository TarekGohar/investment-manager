/**
 * Zero-dependency CSV parser, scoped to broker exports. Handles:
 *  - Quoted fields (with embedded commas, quotes, newlines)
 *  - CRLF / LF / CR line endings
 *  - UTF-8 BOM at start of file
 *  - Trailing blank lines / blank trailing field on rows ending with comma
 *
 * Deliberately does NOT do:
 *  - Encoding detection (caller must hand us a UTF-8 string)
 *  - Type coercion (everything is string; the broker translator parses
 *    numbers / dates with its own rules)
 *  - Streaming (broker activity exports are small enough — a 10-year
 *    history is well under a megabyte)
 *
 * Returns the header row separately from the data rows so downstream code
 * can address columns by name.
 */

export type ParsedCsv = {
  header: string[];
  rows: string[][];
};

export class CsvParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`CSV parse error at line ${line}, col ${column}: ${message}`);
    this.name = "CsvParseError";
  }
}

export function parseCsv(input: string): ParsedCsv {
  // Strip BOM if present.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const all: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let col = 1;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          col += 2;
          continue;
        }
        inQuotes = false;
        i++;
        col++;
        continue;
      }
      if (c === "\n") {
        line++;
        col = 0;
      }
      field += c;
      i++;
      col++;
      continue;
    }

    if (c === '"') {
      if (field.length > 0) {
        throw new CsvParseError("unexpected quote in unquoted field", line, col);
      }
      inQuotes = true;
      i++;
      col++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      col++;
      continue;
    }
    if (c === "\r") {
      // Treat CRLF as one newline; ignore lone CR (rare)
      if (text[i + 1] === "\n") i++;
      pushRow(row, field, all);
      row = [];
      field = "";
      i++;
      line++;
      col = 1;
      continue;
    }
    if (c === "\n") {
      pushRow(row, field, all);
      row = [];
      field = "";
      i++;
      line++;
      col = 1;
      continue;
    }
    field += c;
    i++;
    col++;
  }

  // Final row (file may or may not end with a newline).
  if (field.length > 0 || row.length > 0) {
    pushRow(row, field, all);
  }
  if (inQuotes) {
    throw new CsvParseError("unterminated quoted field", line, col);
  }

  if (all.length === 0) {
    return { header: [], rows: [] };
  }
  const header = all[0].map((s) => s.trim());
  const rows = all.slice(1);
  return { header, rows };
}

function pushRow(row: string[], lastField: string, out: string[][]) {
  row.push(lastField);
  // Skip purely-blank rows (common at end-of-file or between sections).
  const allBlank = row.every((c) => c.trim() === "");
  if (allBlank) return;
  out.push(row);
}

/**
 * Build a case- and whitespace-insensitive column index from a header row.
 * Returns a function that resolves a logical column name to its index, or
 * undefined if the column isn't present.
 *
 * Lets broker translators be forgiving about variant header spellings ("Net
 * Amount" vs "Net Amount " vs "net amount") without duplicating normalization
 * logic.
 */
export function buildColumnIndex(header: string[]) {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    map.set(normalizeHeader(h), i);
  });
  return (name: string): number | undefined => map.get(normalizeHeader(name));
}

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}
