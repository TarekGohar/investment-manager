import "server-only";
import { getFundamentals, getNews, getQuote } from "@/lib/marketdata";
import {
  getEnrichedPortfolio,
  getHolding,
  getTransactionHistory,
} from "@/lib/portfolio/queries";
import type { ToolDefinition } from "./types";

/**
 * Returns the toolset bound to a given user. Tools that need user context
 * (portfolio, positions, transactions) close over `userId`. Pure data tools
 * (quote, news, fundamentals) ignore it.
 */
export function buildTools(userId: string): ToolDefinition[] {
  return [
    {
      name: "get_quote",
      description:
        "Live (15-min delayed) quote for a US equity ticker. Returns price, day change, % change, day high/low, previous close, and timestamp.",
      parameters: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "Stock ticker symbol, e.g. AAPL, NVDA, BRK.B",
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const q = await getQuote(ticker);
        if (!q) return { error: `No quote available for ${ticker}.` };
        return {
          ticker: q.ticker,
          price: q.price,
          change: q.change,
          changePct: q.changePct,
          prevClose: q.prevClose,
          open: q.open,
          high: q.high,
          low: q.low,
          asOf: q.asOf,
          source: q.source,
        };
      },
    },

    {
      name: "get_news",
      description:
        "Recent company news for a ticker. Returns headline, summary, source, URL, published timestamp. Use to ground commentary on what's actually happening.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          limit: {
            type: "integer",
            description: "Max stories to return (default 8, max 20).",
            minimum: 1,
            maximum: 20,
          },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        const limit = clampInt(getProp(input, "limit"), 8, 1, 20);
        if (!ticker) return { error: "Missing ticker." };
        const items = await getNews(ticker, limit);
        return items.map((n) => ({
          headline: n.headline,
          summary: n.summary,
          source: n.source,
          publishedAt: n.publishedAt,
          url: n.url,
        }));
      },
    },

    {
      name: "get_fundamentals",
      description:
        "Company fundamentals: market cap, P/E (TTM), dividend yield, beta, 52-week range, industry, exchange.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const f = await getFundamentals(ticker);
        return f ?? { error: `No fundamentals available for ${ticker}.` };
      },
    },

    {
      name: "get_my_portfolio",
      description:
        "The user's entire portfolio derived from their transaction ledger. Returns each holding with shares, avg cost, cost basis, market value, day change, unrealized P&L, plus totals across the book.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        return await getEnrichedPortfolio(userId);
      },
    },

    {
      name: "get_my_position",
      description:
        "A single position the user holds: shares, avg cost, cost basis, realized gain, dividends received, holding period. Returns an error if the user does not hold this ticker.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        const h = await getHolding(userId, ticker);
        if (!h) return { error: `You don't currently hold ${ticker}.` };
        return h;
      },
    },

    {
      name: "get_transaction_history",
      description:
        "The user's transaction history for a ticker: each buy, sell, dividend, and split with date, quantity, price, fees.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ticker = String(getProp(input, "ticker") ?? "").toUpperCase();
        if (!ticker) return { error: "Missing ticker." };
        return await getTransactionHistory(userId, ticker);
      },
    },
  ];
}

function getProp(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
