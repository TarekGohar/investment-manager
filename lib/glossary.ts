/**
 * One-line plain-English definitions for technical terms scattered across
 * the UI. Surfaced via the <Term> component as a native browser tooltip
 * (no JS, no library, just `<abbr title>` semantics).
 *
 * Keep definitions concrete and short — a tooltip is for "what does this
 * word mean", not "explain the concept end to end". If a term needs a
 * paragraph, the place for that is the AI chat, not a hover.
 */
export const GLOSSARY: Record<string, string> = {
  // ─── Cost basis / tax ───────────────────────────────────────────────
  ACB:
    "Adjusted Cost Base — your average buying price per share, including fees. CRA uses this to figure out your capital gains.",
  "Average cost":
    "Your average buying price per share, including fees (also called ACB).",
  "Cost basis":
    "The total amount you paid for a position, including fees — what you're measured against to compute gain or loss.",
  "Cost/sh":
    "Average cost per share across all your accounts for this ticker, including fees. Same idea as ACB, but spans registered + non-registered. ACB (for CRA capital-gains purposes) is the non-registered slice only.",
  FWT:
    "Foreign Withholding Tax — tax withheld at source on dividends from foreign companies (typically 15% on US dividends in non-registered accounts).",
  "Foreign withholding tax":
    "Tax that foreign countries (mostly the US) hold back on dividends paid to you. Typically 15%. Recoverable on your Canadian tax return if held in a non-registered account.",
  "Foreign tax withheld":
    "Dollar amount of foreign tax that was held back on your dividends. Recoverable on non-registered via the T1 foreign tax credit; lost in TFSA/FHSA.",
  FTC:
    "Foreign Tax Credit — a credit on your Canadian tax return that refunds you for foreign withholding tax paid in non-registered accounts.",
  "Realized P&L":
    "Profit or loss from positions you've already sold. Locks in once the sell goes through — taxable in non-registered accounts.",
  "Unrealized":
    "Profit or loss on positions you still hold — 'on paper' until you sell.",
  "Unrealized P&L":
    "Profit or loss on positions you still hold — 'on paper' until you sell.",
  "Unrealized cap gain":
    "Profit on positions you still hold that you'd owe tax on if you sold today. Only counts the non-registered portion since gains in TFSA/RRSP/FHSA aren't taxable.",
  "Capital gain":
    "Profit from selling an investment for more than you paid. In Canada, 50% of the gain is added to your taxable income (the 'inclusion rate').",
  "Cap gain":
    "Profit from selling an investment for more than you paid. In Canada, 50% of the gain is added to your taxable income.",
  Disposition:
    "Tax-speak for selling a position (or otherwise triggering a capital gain/loss event).",
  "Asset location":
    "Putting tax-efficient investments in non-registered accounts and tax-inefficient ones (like US dividend stocks or REITs) in registered accounts to save tax.",

  // ─── Strategy / tax planning ────────────────────────────────────────
  TLH:
    "Tax-Loss Harvesting — selling a position at a loss to lower your tax bill, then optionally buying a similar (but not identical) replacement.",
  "Superficial loss":
    "A capital loss the CRA disallows because you bought the same security within 30 days before or after selling it. The disallowed loss gets added to the cost basis of the replacement shares.",
  ROC:
    "Return of Capital — a distribution that's not income; it's a partial return of your original investment, so it reduces your cost basis instead of being taxed.",
  T3:
    "Canadian tax slip issued by trusts and REITs that breaks distributions into income types (eligible dividends, capital gains, return of capital, etc.).",
  T5:
    "Canadian tax slip from your broker that reports dividends, interest, and foreign income earned in non-registered accounts.",
  T5008:
    "Canadian tax slip listing every sell (disposition) you made in non-registered accounts — used to compute capital gains.",
  DRIP:
    "Dividend Reinvestment Plan — automatically using dividend payouts to buy more shares of the same stock.",

  // ─── Performance metrics ────────────────────────────────────────────
  TWR:
    "Time-Weighted Return — your portfolio's return ignoring the timing of deposits and withdrawals. The 'stock-picking only' return.",
  IRR:
    "Internal Rate of Return — your annualized return accounting for when you put money in and took money out.",
  Sharpe:
    "Sharpe Ratio — how much extra return you got per unit of risk you took. Higher is better. >1 is good, >2 is rare.",
  Beta:
    "How much your portfolio (or a stock) swings compared to the broader market. 1.0 = same, 1.2 = 20% more volatile, 0.8 = 20% less.",
  Drawdown:
    "How far below a previous high a stock or portfolio has fallen. A 20% drawdown means you're 20% below the recent peak.",
  "Max drawdown":
    "The biggest drop from peak-to-trough your portfolio has seen over the measured period.",

  // ─── Policy / plan ──────────────────────────────────────────────────
  IPS:
    "Investment Policy Statement — your written plan for what mix of investments you want to own.",
  Drift:
    "How far your actual holdings have wandered from the targets you set in your investment plan.",
  "Drift threshold":
    "How far off-target a category has to be before the platform pings you to rebalance.",

  // ─── Company fundamentals (less critical but show up in chat) ──────
  "P/E":
    "Price-to-Earnings ratio — how many times the company's annual earnings the stock costs. Higher = more expensive relative to current profit.",
  "Forward P/E":
    "Same as P/E but uses next year's expected earnings instead of last year's actuals.",
  EBITDA:
    "Earnings Before Interest, Taxes, Depreciation, and Amortization — a rough proxy for the cash a business produces from operations.",
  FCF:
    "Free Cash Flow — cash the business produces after paying for operations and capital investment. The actual money available for buybacks, dividends, and growth.",
  ARR:
    "Annual Recurring Revenue — for subscription businesses, the run-rate of revenue from existing customers.",
  ETF:
    "Exchange-Traded Fund — a basket of stocks (or bonds) that trades like a single stock. Common way to buy broad market exposure.",

  // ─── Brokerage / account types (clarification, not jargon) ─────────
  TFSA:
    "Tax-Free Savings Account — Canadian registered account; gains and dividends are tax-free. Annual contribution limit.",
  RRSP:
    "Registered Retirement Savings Plan — Canadian registered account; contributions deduct from taxable income, gains grow tax-deferred until withdrawal.",
  FHSA:
    "First Home Savings Account — Canadian registered account for first-home buyers. Contributions deduct AND withdrawals for a qualifying home are tax-free.",
  "Non-registered":
    "Regular taxable investment account — gains, dividends, and interest are all taxable in the year received.",

  // ─── Misc terms that show up in alert messages ─────────────────────
  "Marginal rate":
    "The tax rate that applies to your next dollar of income — what matters for decisions about whether to realize a gain or harvest a loss.",
  "Risk-free rate":
    "What you'd earn on a no-risk investment, typically a short-term government bond. Used as a baseline for measuring whether your portfolio is being rewarded for the risk it's taking.",
};
