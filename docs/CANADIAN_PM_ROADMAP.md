# Canadian PM Roadmap

> Living plan for taking this app from "portfolio tracker with AI chat" to "competitive Canadian retail PM replacement." Update as scope changes.

**Audience:** single user, Canadian, Quebec resident, mixed registered + non-registered accounts.

**Goal:** by the end of Session 7, the app should handle the day-to-day judgment work of a Canadian retail portfolio manager — tax-optimal trades, account-type-aware routing, real performance and risk metrics, fundamental analysis depth, behavioral guardrails.

---

## 1. Context corrections (Canadian ≠ American)

The current code was built against US tax assumptions. These are wrong for our user.

| Concept | US (current code) | Canada (CRA) |
|---|---|---|
| Cost basis method | FIFO / HIFO / specific-lot | **ACB** — weighted average, no lot choice |
| Holding-period tax tiering | Short-term vs long-term (1-yr rule) | **No distinction** — all cap gains taxed at 50% inclusion |
| Wash-sale rule | 30 days *before+after*, loss forfeited | **Superficial loss rule** — 30 days *before AND after*; loss is **added to the ACB of replacement**, not forfeited; extends to spouse + your corp |
| Tax-advantaged accounts | Traditional IRA / Roth / HSA / 401(k) | **TFSA / RRSP / FHSA / RESP / LIRA / RRIF** |
| Foreign withholding | Generally recoverable via FTC | **Depends on account type** — non-recoverable in TFSA, treaty-zeroed in RRSP, recoverable in non-reg |
| Provincial tax | Mostly federal-only logic | **Quebec adds 14–25.75% provincial** on top of federal; highest combined rates in Canada |
| Tax slips | 1099-DIV, 1099-B | **T5 / T3 / T5008** (federal) + **RL-3 / RL-16** (Quebec) |

---

## 2. Sessions

Each session is one focused build. Schema + logic + UI + minimal docs. Typecheck clean at the end.

### Session 1 — Canadian schema + ACB foundation

**Goal:** structurally model Canadian accounts. Replace FIFO with ACB so realized gains are calculated the way CRA expects.

**Schema deltas**
- `BrokerageKind` enum: `NON_REGISTERED | TFSA | RRSP | FHSA | RESP | LIRA | RRIF | JOINT_NON_REGISTERED`
- `Brokerage.kind` field (default `NON_REGISTERED`)
- `ContributionRoom` table — `(userId, kind, year)` keyed; stores user-input room from CRA Notice of Assessment / MyCRA portal
- `Transaction.foreignTaxWithheld` decimal field — for DIVIDEND rows on US/foreign securities

**Modules**
- `lib/portfolio/acb.ts` — new derivation: weighted-average ACB, per-share-ACB-stable-on-partial-sells realized gain. Pure function.
- `lib/portfolio/holdings.ts` — rewritten to call ACB derivation. FIFO logic deleted.
- `lib/portfolio/types.ts` — `Holding.avgCost` → `Holding.acb` rename; `Brokerage` extended.

**UI**
- Settings → Brokerages: per-account `Kind` selector (dropdown), kind badge in row header
- All "Avg cost" labels → "ACB" with a hover tooltip explaining what ACB is and why CRA uses it
- Position page: ACB shown prominently; capital gain shown both pre- and post-50%-inclusion

**Out of scope (deferred)**
- Splitting holdings display by account type (Session 2)
- Pooling ACB strictly across non-reg only (Session 2) — for now, single pool across all txns
- Contribution-room enforcement (Session 4) — schema only this session

**Files touched:** ~12

---

### Session 2 — Asset location + foreign withholding tax intelligence

**Goal:** for the first time, the app knows that *where* you hold an asset matters as much as *what* you hold. Surface the FWT bleed and suggest moves.

**Schema deltas**
- Add `aiSeverity` already exists; no schema changes expected
- May add `AssetLocationFlag` (computed, not stored) — derived in code

**Modules**
- `lib/canadian/location.ts` — scoring function:
  - For each holding, compute optimal account type given dividend yield, US-exposure, asset class
  - Output: `{ optimal: BrokerageKind, current: BrokerageKind, score: "optimal" | "suboptimal" | "mislocated", reasoning: string, estimatedAnnualBleed: number }`
- `lib/canadian/fwt.ts` — track foreign tax withheld per dividend, annual rollup
- ACB pooling: limit to NON_REGISTERED + JOINT_NON_REGISTERED brokerages. Separate display for registered holdings.

**UI**
- Position page: per-account breakdown of holdings (TFSA: 30 sh, RRSP: 50 sh, Non-reg: 20 sh)
- "Location score" pill per holding: 🟢 optimal · 🟡 suboptimal · 🔴 mislocated with $X/yr cost
- Dashboard: aggregate "Estimated annual FWT bleed: $X — fixable by moving N positions" call-out
- AI chat tools: `get_location_analysis()` so the PM persona can speak to this

**Files touched:** ~10

---

### Session 3 — Superficial loss + tax-loss harvesting

**Goal:** TLH engine that respects the Canadian superficial loss rule. Pre-trade warnings. Replacement-pair library.

**Schema deltas**
- `HarvestSuggestion` table — generated daily by a new cron, dismissable
- `SuperficialLossEvent` table — flags violations so user knows their loss was disallowed and got added to ACB elsewhere
- Adjustments to ACB derivation: when a superficial loss is detected, the disallowed loss flows into the replacement's ACB

**Modules**
- `lib/canadian/superficial-loss.ts`:
  - `detectSuperficialLoss(sale, transactions)` — scans 30 days before + after across all user accounts
  - `wouldCreateSuperficialLoss(proposedBuy, transactions)` — pre-trade check
- `lib/canadian/tlh.ts`:
  - `findHarvestCandidates(holdings, quotes)` — losses meaningful enough to harvest
  - `suggestReplacement(ticker)` — uses curated pair library (50 pairs covering Cdn / US / global / bonds)
  - Tax saving estimate using Quebec combined marginal rate

**Cron**
- `/api/cron/scan-tlh` runs nightly during trading season, populates `HarvestSuggestion` rows

**UI**
- New `/tax` page: harvest candidates list with sell-now + buy-back-on-day-31 plan, dismiss/snooze controls, harvested loss log
- Transaction form: real-time pre-trade warning when a BUY would create a superficial loss on a recent loss sale
- Alerts: new rule `SUPERFICIAL_LOSS_WINDOW` fires when you're inside an active 30-day window with a pending replacement decision

**Replacement pair library** (curated, in code):
- VFV ↔ XUS ↔ ZSP (S&P 500)
- VCN ↔ XIC ↔ ZCN (Canada broad)
- VAB ↔ ZAG ↔ XBB (Canada bonds)
- VXC ↔ XAW (world ex-Canada)
- (~50 pairs total)

**Files touched:** ~15

---

### Session 4 — Contribution room + Quebec tax overlays + slip prep

**Goal:** room tracking with over-contribution prevention. Quebec marginal-rate calculator. Year-end CSV export for T1 + TP1.

**Schema deltas**
- `ContributionRoom` populated via UI per (kind, year)
- Year-end realized totals: derive on demand from `Transaction` table

**Modules**
- `lib/canadian/contribution-room.ts`:
  - Track used room per (kind, year) from BUY transactions
  - Carry-forward logic for RRSP / FHSA
  - Over-contribution detection (warn + hard-block at 100%)
- `lib/canadian/tax-rates.ts`:
  - 2025 + 2026 federal + Quebec brackets (hand-edited table)
  - Functions: `marginalRateOnOrdinaryIncome(income)`, `marginalRateOnCapGains(income)`, `dividendTaxCredit(grossDividend, type: "eligible" | "non-eligible")`
- `lib/canadian/slips.ts`:
  - Generate CSV mirroring T5 (interest + dividend income), T5008 (capital gains/losses dispositions), RL-3 (Quebec investment income) — for tax-prep software import

**UI**
- New `/tax` page (extends from Session 3): "This year's view" with realized cap gains, dividends by type, FWT paid, contribution room used per account type, estimated tax impact at Quebec brackets
- Year-end export panel: download T5, T5008, RL-3-style CSVs
- Transaction form: BUY in TFSA/RRSP/FHSA shows remaining room + warns if going over

**Files touched:** ~12

---

### Session 5 — SEDAR+ and EDGAR filings deep-dive

**Goal:** every held company's filings get read by AI on release. The dashboard PM's read card surfaces "what changed this quarter for your holdings."

**Schema deltas**
- `Filing` table — `(ticker, type: "10-Q" | "10-K" | "8-K" | "MD&A" | "AIF", source: "EDGAR" | "SEDAR+", url, filedAt, body?)`
- `AIAnalysis.kind` gets new value `QUARTERLY_DEEP`

**Modules**
- `lib/filings/edgar.ts` — fetch by CIK, list filings, get text
- `lib/filings/sedar.ts` — SEDAR+ has a JSON API for filing lists; XBRL Canadian taxonomy for financials
- `lib/ai/filings.ts`:
  - `summarizeQuarterly(ticker, current, prior)` — multi-section AI report comparing QoQ
  - Targets: revenue trend, margin direction, segment performance, MD&A red flags, share count change, debt change, guidance change, cash flow
  - 600–800 word markdown output

**Cron**
- `/api/cron/pull-filings` runs daily — new filings per held ticker → AIAnalysis row

**UI**
- Position page: new "Filings" tab with the AI quarterly card + filing history list with links
- AI chat tools: `get_latest_filing_analysis(ticker)`

**Files touched:** ~10

---

### Session 6 — Performance + risk metrics

**Goal:** the numbers a real PM tracks. Daily NAV snapshots, time-weighted and money-weighted returns, beta, Sharpe, max drawdown, correlation matrix.

**Schema deltas**
- `PortfolioSnapshot` table — daily NAV per user (cost basis, market value, by account type)

**Modules**
- `lib/portfolio/snapshots.ts` — written by EOD cron
- `lib/portfolio/performance.ts`:
  - `twr(snapshots, transactions, period)` — time-weighted return
  - `irr(transactions, currentValue)` — internal rate of return (Newton's method or similar)
  - `beta(portfolioReturns, marketReturns)` — vs SPY/VFV
  - `sharpe(returns, riskFreeRate)` — pull risk-free rate from FRED (Canada uses Bank of Canada policy rate; FRED has DCDR or similar — pick one)
  - `maxDrawdown(snapshots)`
  - `correlationMatrix(holdings, candles)` — pairwise across holdings

**Cron**
- `/api/cron/eod-snapshot` runs at 21:30 UTC on trading days — writes PortfolioSnapshot rows

**UI**
- Dashboard: new "Performance" tab with TWR/IRR vs SPY benchmark, beta, Sharpe, max DD
- Portfolio page: correlation matrix heatmap
- AI chat tools: `get_performance_metrics()` so PM persona references actual numbers

**Files touched:** ~10

---

### Session 7 — IPS, thesis tracker, behavioral pattern detection

**Goal:** judgment infrastructure. Force the user to be explicit about goals, capture trade reasoning, detect destructive patterns.

**Schema deltas**
- `InvestmentPolicy` table — `targetAllocation` (sector?, account-type?, asset-class?), `driftThreshold`, `rebalanceCadence`, `tlhThreshold`
- `Thesis` table — `(ticker, body, invalidationCriteria, priceTarget, horizonMonths, createdAt, status: "active" | "trimmed" | "exited" | "invalidated")`
- `TradeNote` (optional) — attached to Transaction, captures pre-trade reasoning

**Modules**
- `lib/policy/ips.ts` — store and check actual vs target allocation; surface drift
- `lib/policy/thesis.ts`:
  - Track per-position thesis
  - Weekly AI check: "Given current quote + news + filings, is this thesis still intact?"
  - Auto-flag invalidation candidates
- `lib/behavioral/patterns.ts`:
  - `detectPanicSell(transactions)` — selling within 5 days of a >10% drawdown
  - `detectFomoBuy(transactions)` — buying within 5 days of a >20% runup
  - `detectAveragingDownWithoutThesis(transactions, theses)` — multiple buys during drawdown with no thesis update
  - `detectOvertrading(transactions, window)` — >N trades/month, with tax+slippage cost estimate

**Cron**
- `/api/cron/thesis-review` runs weekly — AI re-validates each active thesis against current data
- Behavioral patterns checked in real-time on transaction create (alert fires if pattern matched)

**UI**
- New `/policy` page — IPS configuration, current drift display, rebalance proposals
- Position page: thesis card with body + invalidation criteria + AI confidence + last-review date
- Transaction form: optional thesis prompt on first BUY of a ticker
- Behavioral alerts surface as a distinct event kind in `/alerts`

**Files touched:** ~15

---

## 3. Order rationale

Why this specific sequence:

1. **Session 1 first** because every other session needs correct ACB to compute against. Tax rules are foundational, not a feature.
2. **Session 2 (FWT/location) before Session 3 (TLH)** because TLH suggestions should already know the asset is mislocated — a "harvest this US dividend payer" suggestion is incomplete if it doesn't also flag that the replacement should go in RRSP.
3. **Session 4 (Quebec rates + slips) after TLH** because TLH suggestions are worth more when they cite a tax-saving estimate using the Quebec marginal rate.
4. **Sessions 5–6 (filings + performance) before Session 7 (IPS/thesis)** because the IPS + thesis review uses filing summaries and performance attribution as inputs to its "still intact?" judgment.

---

## 4. Out of scope (intentionally deferred)

- **Spouse-tagged accounts** — explicitly skipped per user direction; superficial loss detector won't catch cross-spouse purchases.
- **Corporate accounts** (CCPC, Holdco) — different rules; out of scope for personal app.
- **Bonds / fixed income duration math** — schema doesn't model maturity, coupon, YTM.
- **Options** — track positions but no Greeks, no covered-call strategy.
- **International (non-US) holdings** — minor depth: we'll handle UK/EU ADRs as US-like; no full international tax treaty model.
- **Multi-broker aggregation** — no Plaid/SnapTrade integration; manual entry only.
- **Cryptocurrency** — not in scope.
- **Real-time intraday data** — staying with 15-min delayed quotes; daily candles for analysis.

---

## 5. Open questions

| Question | Status |
|---|---|
| Spouse account tagging | Decided: **no** |
| Existing positions outside the app | Pending — assume all transactions are entered manually going forward |
| Quebec-only credits (CRCD, FTQ funds) | Likely punted to a future "Tax credits" section |
| Income other than dividends (interest, royalties, REIT distributions) | Modeled as DIVIDEND for now; refine in Session 4 |

---

## 6. Definition of done (per session)

- Schema migrated, Prisma client regenerated
- TypeScript clean
- Unit-level "feels right" pass (no automated tests in scope for this app)
- PLAN.md updated with the new completed phase
- Docs (this file) updated with any decisions made during the build
