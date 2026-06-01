# Platform Activation Roadmap

> Living plan for turning this app from "deep-but-passive Canadian PM tool" into "a coach that surfaces the right moment, leaves the action to you, and stays silent the rest of the time." Update as scope changes.

**Audience:** single user, Canadian (Quebec), mixed registered + non-registered accounts, long-term buy-and-hold across Canadian + US equities.

**Goal:** by the end of Session 7, the app should (a) hold clean enough data to be the source of truth for tax filings, (b) speak only when something on your IPS, in your theses, or in your tax window genuinely warrants attention, and (c) recommend the move + track the intent — never act on your behalf.

---

## 1. Operating principles (lock these in)

These are the rules every session must obey.

| Principle | What it means in practice |
|---|---|
| **Advisor, not executor** | The app fires alerts, suggests plans, and tracks your stated intent. It never auto-records trades. You execute at your broker; you come back and record; the app reconciles. |
| **Silence by default** | No daily email. No daily report cron. Email digests fire only when something material happened (alert ≥ MATERIAL, thesis-invalidation candidate, IPS drift breach, TLH opportunity newly open, new filing for a held ticker). |
| **Event-driven cadence** | Time-based crons are reserved for end-of-day snapshots and the weekly review. Everything else fires on real events. |
| **Pre-entry guards over retroactive flags** | A panic-sell, a superficial loss, or a thesis-violating trade should generate a warning at the transaction form, not three weeks later in a behavioral-patterns dashboard. |
| **Reason codes on every sell** | Every SELL captures *why*. The behavioral detector, the alert engine, and the AI coach all read this to know when to stay quiet vs when to coach. |
| **Don't add features that can't tell you a decision** | A new card on the dashboard must answer "what do I do with this?" If the answer is "look at it," it doesn't ship. |

---

## 2. Sessions

Each session is one focused build. Schema + logic + UI + minimal docs. Typecheck clean at the end. Scoped to one prompting session of ~30 min – 2 hours.

---

### Session 1 — Data-integrity foundation

**Goal:** make the ledger trustworthy enough to be the source of truth for tax filings before any historical data is entered. Every fix in this session is a one-way door — doing it after data is entered means manual reconstruction.

**Schema deltas**
- `Transaction.fxRateToCad Decimal?` — populated automatically on entry when `currency != "CAD"`. Stores the CAD-equivalent rate at trade date.
- `Transaction.reasonCode SellReason?` — required at SELL only. Enum: `REBALANCE_DRIFT | THESIS_INVALIDATED | TLH_HARVEST | TAX_PLANNING | CASH_NEED | DISCRETIONARY`.
- `Transaction.isDrip Boolean @default(false)` — for BUY rows that represent a dividend reinvestment inside a registered account. Excluded from contribution-room math.
- Indexes for dup-detection lookups on `(userId, brokerageId, ticker, kind, occurredAt)`.

**Modules**
- `lib/marketdata/fx.ts` — new module. `getFxRateToCad(currency, date)` calls BoC Valet API (`https://www.bankofcanada.ca/valet/observations/FX{CCY}CAD/json`), caches results in a new `FxRate` Prisma model keyed on `(currency, date)`, falls back to most recent observation if the date is a weekend/holiday.
- `lib/portfolio/holdings.ts` — ROC math wired: a DIVIDEND row with `dividendType = RETURN_OF_CAPITAL` reduces the pool's total cost basis (and therefore per-share ACB) instead of being treated as income.
- `lib/portfolio/holdings.ts` — contribution-room derivation rewritten. Old: sum BUYs in registered accounts. New: sum DEPOSIT rows + FMV of TRANSFER_IN rows where source is external cash, minus any BUY with `isDrip = true`.
- `lib/portfolio/transactions.ts` — server action `createTransaction` extended with: (a) auto-FX-fetch when currency ≠ CAD, (b) duplicate-detection warning, (c) requiring `reasonCode` for SELL.

**UI**
- Transaction form: when currency ≠ CAD, show the fetched FX rate inline ("BoC USD/CAD on 2026-03-15: 1.3742") with an override field. When SELL is chosen, render reasonCode dropdown beneath kind. When a near-duplicate is detected, show a yellow warning above the submit button with "create anyway" override.
- Transaction list: small "DRIP" badge on BUY rows where `isDrip = true`; small "RC: TLH" / "RC: rebalance" pill on SELL rows.
- Settings → Contribution room: clarify that the displayed "used room" now excludes DRIP and inter-account transfers.

**Out of scope (deferred)**
- Bulk CSV import (Session 3)
- TLH coaching alerts (Session 4)
- REIT distribution decomposition wizard (Session 7)

**Files touched:** ~10

**Done when:**
- Typecheck clean.
- Can create a USD BUY and see the BoC rate auto-populated.
- Can mark a DIVIDEND as `RETURN_OF_CAPITAL` and watch per-share ACB drop.
- Can create a SELL and be required to pick a reason code.
- Can attempt a duplicate and be warned.
- Contribution-room calculator excludes a TRANSFER_IN and a DRIP'd BUY.

---

### Session 2 — Cadence rebalance + email silence

**Goal:** cut ~90% of cron noise without losing signal. Convert daily-review from a fixed-cadence broadcast into an on-demand button. Switch email digests from "always fire" to "fire only on material events."

**Schema deltas**
- None. Pure config + handler changes.

**Modules**
- `vercel.json`: remove `/api/cron/daily-review`; collapse `refresh-quotes`, `classify-news`, `run-alerts` into a single 21:00 UTC weekday run; keep `weekly-review`, `eod-snapshot`, `pull-filings`.
- `app/api/cron/run-alerts/route.ts`: email digest only sends when at least one of (`alertSeverity ≥ MATERIAL`, `THESIS_INVALIDATION_CANDIDATE` fired, `IPS_DRIFT_BREACH` fresh, `TLH_OPPORTUNITY_NEW` fresh, new filing for held ticker) fired. Otherwise silent.
- `app/api/ai/daily-review/route.ts`: new on-demand POST endpoint that runs the same `generateDailyReview` previously triggered by cron.
- `lib/ai/reviews.ts`: no logic change; just gets called from the new route + dashboard button.

**UI**
- Dashboard: replace "Latest PM read" passive card with an active "Generate today's report" button + last-generated timestamp. Clicking it streams a fresh review.
- Settings → Cron: relabel from "Cron jobs" to "Background jobs" and reflect new schedule.
- Settings → Notifications: add "Silent unless material" toggle (default ON) controlling the alert digest filter.

**Out of scope (deferred)**
- Recommendation alerts themselves (Session 4 wires the new severity-elevating events).

**Files touched:** ~6

**Done when:**
- `vercel.json` reflects the new schedule.
- The dashboard button generates a review on demand.
- A test alert that's INFO-only produces no email; a MATERIAL alert does.

---

### Session 3 — Bulk CSV import (one importer per broker)

**Goal:** make inputting historical data a one-shot exercise instead of a multi-weekend retyping project. Without this, every session after Session 1 is hypothetical.

**Schema deltas**
- `ImportBatch` table — `(userId, brokerage, sourceFilename, importedAt, transactionCount, status)` for audit + rollback.
- `Transaction.importBatchId String?` — nullable FK to allow bulk delete of a botched import.

**Modules**
- `lib/import/csv.ts` — generic CSV parser + column-mapping engine.
- `lib/import/brokers/questrade.ts`, `lib/import/brokers/rbc-di.ts`, `lib/import/brokers/wealthsimple.ts`, etc. — one module per broker with column maps and transaction-kind translation tables. Start with the two brokers holding the user's bulk history.
- `lib/import/dedup.ts` — runs Session 1's duplicate-detection against existing data and the import set itself.

**UI**
- Settings → Import: file upload, broker selector, dry-run preview table ("we'll create 247 transactions; here are the first 20"), per-row "skip / include / mark as duplicate" controls.
- Import history page: list of past imports with status, transaction count, "roll back this import" button.

**Out of scope (deferred)**
- Mid-import column-mapping UI (start with hard-coded maps per broker)
- Auto-detection of broker from CSV header

**Files touched:** ~12 (skeleton + per-broker)

**Done when:**
- Can upload a Questrade activity CSV and dry-run preview shows accurate transaction translation.
- Confirming the import creates the rows with the correct `importBatchId`.
- Rolling back removes them cleanly.

---

### Session 4 — The "recommend the moment" engine

**Goal:** make the platform behave like a coach. Three new alert categories, all advisory. Each one identifies a moment, suggests a plan, accepts user "intent to act," and tracks the follow-through.

**Schema deltas**
- New `AlertRule` enum values: `TLH_OPPORTUNITY | REBALANCE_DUE | THESIS_INVALIDATION_CANDIDATE`.
- `PlannedAction` table — `(userId, kind, ticker?, payload Json, plannedAt, expiresAt, fulfilledAt?, dismissedAt?)`. Tracks what the user *intends* to do after responding to an alert.
  - `kind` enum: `TLH_HARVEST | REBALANCE | THESIS_REEVALUATION`.

**Modules**
- `lib/coaching/tlh-watch.ts` — runs after eod-snapshot. For each non-reg holding: market value below ACB by > X%, no BUY of same ticker in last 30 days, no `PlannedAction(kind=TLH_HARVEST)` already open. Fires `TLH_OPPORTUNITY` alert. Email content includes harvest size, estimated tax saving (using user's marginal rate from `tax_profile`), replacement candidate from the existing pair library.
- `lib/coaching/rebalance-watch.ts` — runs daily after eod-snapshot. Checks IPS drift per category. If any category exceeds `driftThresholdPct` for ≥ 3 trading days, fires `REBALANCE_DUE` alert with a suggested plan: sell from over-weight account-type preferring TFSA/RRSP for the realized gain side, buy in under-weight, respecting contribution room.
- `lib/coaching/intent-tracking.ts` — server actions: `markIntentToAct(alertId)` creates a `PlannedAction`; `dismissAlert(alertId)` sets `dismissedAt`. When a SELL with matching `reasonCode` is recorded, fulfills the matching `PlannedAction`.
- `lib/portfolio/transactions.ts` — pre-entry guards extended:
  - **Superficial-loss imminent:** SELL with realized loss + same-ticker BUY within ±30d → warn with disallowed-loss amount, mentions which account the loss will flow into.
  - **Panic-sell heuristic:** SELL of position down > `panicSellDrawdownPct` in < `panicSellWindowDays` → "this matches your IPS panic-sell threshold; what's the reason?"
  - **Active-thesis SELL:** SELL of holding with `Thesis.status = ACTIVE` → "your thesis on this position is still marked ACTIVE; update it before selling?"

**UI**
- Email templates: per-alert-kind templates that include the plan + a "mark as planned" link back into the app.
- Dashboard: new "Open recommendations" card listing active `PlannedAction` rows with expiry countdowns.
- Position page: small banner if there's an open `PlannedAction` for this ticker ("You marked a TLH harvest for VFV → XUS as planned 4 days ago. 26 days remaining before the buyback window closes.").
- Transaction form: warning banners as described above; never blockers.

**Out of scope (deferred)**
- Thesis-invalidation-from-filings (Session 5)
- AI auto-tuning the TLH thresholds (out of scope entirely)

**Files touched:** ~14

**Done when:**
- A simulated -8% drawdown on a non-reg holding fires a TLH_OPPORTUNITY email with a complete suggested plan.
- Clicking the email "mark as planned" link creates a PlannedAction and arms the 30-day window check.
- Recording the matching SELL with `reasonCode = TLH_HARVEST` fulfills the PlannedAction.
- A simulated 6% drift past IPS threshold for 3 trading days fires a REBALANCE_DUE alert.
- Pre-entry warnings appear on the transaction form for superficial-loss / panic-sell / active-thesis SELLs.

---

### Session 5 — Thesis-driven alerts from filings

**Goal:** wire the existing AI quarterly-filing summarization to the existing thesis invalidation criteria. When a new 10-K / 10-Q / 40-F / 6-K is filed for a held ticker, check whether the user's stated invalidation criteria are now met. Surface as a `THESIS_INVALIDATION_CANDIDATE` alert.

**Schema deltas**
- `Thesis.lastInvalidationCheckAt DateTime?`
- `Thesis.lastInvalidationConfidence Int?` (0–100)
- `Thesis.lastInvalidationReasoning String?` (Markdown — which criterion triggered)

**Modules**
- `lib/ai/thesis-check.ts` — given a filing summary and a `Thesis`, calls the LLM with a tight prompt:
  > "Given the user's invalidation criteria and the filing summary, judge whether any criterion is now met. Output JSON `{ matched: bool, confidence: 0-100, criterionTriggered: string|null, reasoning: string }`. Be conservative — default to not matched."
- `app/api/cron/pull-filings/route.ts` — after `summarizeQuarterly` writes the AIAnalysis row, call `checkThesisInvalidation` for every user holding that ticker with a non-EXITED non-INVALIDATED thesis. If confidence ≥ 60, fire `THESIS_INVALIDATION_CANDIDATE` alert.

**UI**
- Thesis card on position page: show last check date + last-check verdict.
- Weekly review: section "Theses under pressure this week" listing any THESIS_INVALIDATION_CANDIDATE fired.
- Alert email: tap-through to the thesis editor with the criterion + filing-summary excerpt prefilled.

**Out of scope (deferred)**
- Thesis invalidation from news (vs filings) — news quality is too variable; gate this feature to filings only for v1.

**Files touched:** ~6

**Done when:**
- Simulated 10-Q for a held ticker with a clearly invalidating fact (e.g., revenue −20% YoY against a thesis criterion "revenue growth ≥ 5% YoY") fires the alert with reasoning.
- Thesis card shows the verdict.
- Weekly review surfaces it.

---

### Session 6 — Forecasting + currency + attribution cards

**Goal:** three new dashboard cards that turn the platform from a backward-looking ledger into a forward-looking decision support tool. All read-only computations from data already collected.

**Schema deltas**
- None.

**Modules**
- `lib/portfolio/dividend-forecast.ts` — for each holding: most recent N quarters of DIVIDEND rows × current share count → projected next 4 quarters per (account-kind, currency). Roll up: total CAD-equivalent, taxable non-reg portion, FWT estimate, TFSA/RRSP tax-free portion.
- `lib/portfolio/currency-exposure.ts` — group holdings by traded currency, value in CAD-equivalent using current FX rates. Compute "1¢ CAD/USD move impact on NAV."
- `lib/portfolio/attribution.ts` — YTD performance decomposition. For each holding: `contribution_pp = (holding_return × avg_weight)`. Show top contributors + detractors.

**UI**
- Dashboard: three new cards (dividend forecast, currency exposure, performance attribution).
- Tax page: dividend forecast also surfaced here with per-account-kind tax projection.
- AI chat tools: `get_dividend_forecast`, `get_currency_exposure`, `get_attribution` so the PM persona can speak to them.

**Out of scope (deferred)**
- Sector attribution (vs holding attribution)
- Benchmark-relative attribution (Brinson decomposition is overkill for retail)

**Files touched:** ~10

**Done when:**
- Dashboard shows next-12-month projected dividends with the tax breakdown.
- Currency exposure card shows CAD/USD/other split + NAV sensitivity.
- Attribution card shows YTD contributors with pp impact.

---

### Session 7 — Corporate actions + GIC/bond + REIT decomposition + annual review

**Goal:** close the long-tail gaps that bite buy-and-hold Canadian investors specifically. None of these are common per-trade, but missing any one of them corrupts your ACB or tax picture when they happen.

**Schema deltas**
- New `TransactionKind` value: `CORPORATE_ACTION` with structured payload (`{ from: string, to: [{ticker: string, ratio: number, basisAllocation: number}], event: "SPINOFF"|"MERGER"|"NAME_CHANGE"|"REDENOMINATION" }`).
- `Holding.assetType String?` — derived enum: `EQUITY | ETF | GIC | BOND | REIT | TRUST`. Auto-detected from ticker pattern + fundamentals; user can override.
- `Transaction.maturesAt DateTime?` — nullable, for GIC/bond rows.
- `RoCAllocation` table — `(userId, ticker, year, eligibleDividendPct, nonEligibleDividendPct, interestPct, returnOfCapitalPct, capitalGainPct)`. Used to re-classify DIVIDEND rows from REITs/trusts at year-end.

**Modules**
- `lib/portfolio/corporate-actions.ts` — applies a CORPORATE_ACTION transaction to all affected positions, preserving cost basis allocation.
- `lib/portfolio/gic-bond.ts` — assetType-aware holdings derivation. GIC interest doesn't ACB-track; bond ACB tracks accreted discount.
- `lib/canadian/reit-decomposition.ts` — at year-end (or when user enters a T3 breakdown), re-classifies the year's DIVIDEND rows per the percentages.
- `lib/ai/annual-review.ts` — once-a-year workflow generator. Walks user through every active thesis (still valid?), every IPS category (still aligned?), every TLH opportunity used/missed.

**UI**
- Transaction form: CORPORATE_ACTION kind reveals a multi-row sub-form for spinoff legs.
- Position page: GIC/bond holdings show maturity countdown; REIT holdings show "annual T3 breakdown not entered" warning until user provides it.
- New page `/annual-review`: triggered by user, generates the year's review doc and saves it as a special `AIAnalysis(kind=ANNUAL_REVIEW)` row.

**Out of scope (deferred)**
- Auto-pulling T3 breakdowns from trust websites (manual entry is fine; trusts publish these in March each year)
- Bond accretion math beyond linear straight-line

**Files touched:** ~15

**Done when:**
- A simulated spinoff (e.g., T → T + WBD) records correctly and preserves cost basis allocation.
- A GIC holding shows maturity countdown and doesn't pollute ACB math.
- Entering a 2025 RoCAllocation for a Canadian REIT re-classifies the year's DIVIDEND rows.
- The annual review workflow generates a meaningful doc.

---

## 3. Order of operations

```
Sessions 1 → 2 → 3   (data integrity + cadence + import)
        ↓
  [INPUT YOUR DATA]
        ↓
Session 4            (recommendation engine, now coaching against real data)
        ↓
Sessions 5, 6, 7     (in any order)
```

Sessions 1–3 must land before historical data is entered. Session 4 makes the platform start coaching. Sessions 5–7 are the polish that turns a coach into a system.

---

## 4. Non-goals (intentionally excluded)

- Trade execution (broker integration). The user executes at the broker; the app records. Never the other way.
- Auto-recording trades from broker APIs. The user wants control over what enters the ledger.
- Real-time intraday quotes. 15-min delay is fine for buy-and-hold.
- Multi-user. Single-user assumed throughout.
- Options, futures, crypto, FX trading.
- US-only investors. Quebec-resident Canadian context is the design center.

---

## 5. Backlog (not yet sessioned)

Tracked here so they don't get lost; promote to a session when scope is clear.

- SEDI insider activity for Canadian holdings (currently only EDGAR Form 4 for US)
- Fee/MER drag computation (annual cost per holding, weighted-average portfolio MER)
- "Don't open the app" mobile push notifications (currently email only)
- Encryption at rest for `ExternalCookieSession.cookieHeader`
- DRIP auto-detection heuristic (current Session 1 just adds the field; user must mark it)
- Per-spouse-account tagging (for Canadian superficial-loss rule which extends to spouses)
