# Decision Hub & PM Persona Roadmap

> Living plan for two interlocking upgrades: (a) tightening the AI chat persona so it reasons like a 20-year PM rather than an enthusiastic analyst, and (b) refactoring Alerts into a single Decision Hub where every signal across the platform (cron jobs, AI chat, reviews, manual flags) lands with a recommended action + supporting argument + a manual outcome record. Update as scope changes.

**Audience:** single user, Canadian (Quebec), mixed registered + non-registered accounts, long-term buy-and-hold across Canadian + US equities, holding concentrated single-name positions in quality compounders.

**Goal:** by the end of Session 7, every decision-worthy moment in the platform — whether surfaced by a cron check, raised by the AI in chat, or flagged by an annual review — lands in one inbox with: (i) the trigger, (ii) the supporting evidence from whichever medium produced it, (iii) a recommended action, and (iv) a manually-recorded outcome (what you did, at what price, why). The AI persona changes ensure those recommendations are PM-grade in their first place, and the conviction-re-rating workflow ensures held positions get re-examined on a cadence instead of running on stale enthusiasm.

**Status:** all 7 sessions shipped, plus a post-Session-7 architectural pass (see § 3) that merged the user-facing routes (`/alerts` is now the single inbox), killed the daily review cron (PMs work weekly, not daily), wired weekly + annual reviews to auto-propose decisions, upgraded the TLH + REBALANCE coaching rules to decision-grade, and dropped the forced `REVIEW_THESIS` action in favor of notification-only events when no concrete action applies.

---

## 1. Operating principles (lock these in)

These rules every session must obey. They extend (don't replace) the principles from `PLATFORM_ACTIVATION_ROADMAP.md`.

| Principle | What it means in practice |
|---|---|
| **One inbox, every medium, one route** | A signal from a cron job, the AI chat, a weekly / annual review, or a manual flag becomes the same `AlertEvent` row. `/alerts` is the single user-facing surface: decision-grade events (with `recommendedAction`) get action affordances; notification-only events sit underneath and can be marked read. Decision-Hub-as-separate-route was rejected — one inbox, not two. |
| **Weekly cadence, not daily** | No daily review cron. Real PMs work weekly; daily noise is exactly the trap this platform is designed to avoid. The on-demand "PM's read" on the dashboard generates a weekly review when the user asks for one. |
| **No fake action labels** | If an event has no concrete trade implication (stale-conviction nudge, news flag, conviction-decay notice), it stays notification-only — `recommendedAction = null`. We don't manufacture a `REVIEW_THESIS` placeholder just to give the row a button. Events that need action get one; events that don't, don't. |
| **Manual outcomes, no reconciliation** | Trades are entered manually. Decision outcomes are entered manually. We never try to match a Transaction to an open decision automatically — the user closes the loop in the Hub UI by saying what they did and why. |
| **Supporting argument is mandatory** | A decision event without evidence is noise. Every Hub entry carries the data the recommendation was based on (numbers, tool outputs, links to the source review or chat), preserved at firing time so it doesn't go stale. |
| **Recommendation, not instruction** | Each Hub entry has a recommended action ("trim 3 shares of X back inside the cap") but the outcome enum includes EXECUTED_AS_RECOMMENDED, EXECUTED_REVISED, ABANDONED, REJECTED. All four are first-class — abandoning a recommendation is data, not failure. |
| **Persona changes are config, not code** | Per-name concentration caps, theme caps, and skew requirements go on the IPS, not in the persona prose. The persona reads them. Change the cap → behavior changes. |
| **Don't pretend to know macro** | No regime-forecasting overlays unless there's a structured signal in the DB. Cycle awareness is a hurdle-rate bias only, not a top-down call. |

---

## 2. Sessions

Each session is one focused build. Schema + logic + UI + minimal docs. Typecheck clean at the end. Sized to one prompting session of ~30 min – 2 hours.

---

### Session 1 — PM persona discipline (text-only, no schema)

**Status:** shipped.

**Goal:** ship the five judgment improvements that came out of the chat-log audit. All persona-text changes to `lib/ai/persona.ts`. No new tools, no migrations. This is the cheapest, highest-leverage starting point — it tightens behavior on every existing chat the next time it runs.

**Schema deltas**
- None.

**Modules**
- `lib/ai/persona.ts` — five additions, layered into the existing structure:
  1. **Effective-bet count check on adds.** Before recommending an add to a name sharing a dominant theme with ≥2 other names in the book, the model must invoke `get_performance_metrics` (which already exposes the correlation matrix) and frame the add against effective theme exposure, not bucket weight. Heuristic: no single theme >25-30% of the book unless explicitly chosen.
  2. **Hard concentration cap (not rebalance-to-target).** Quality compounders are allowed to grow into oversized positions inside a hard cap read from `InvestmentPolicy.maxSingleNameWeightPct` (Session 2). When asked about a position over IPS bucket weight but inside the cap, the default is "hold and let it compound." Trims happen *at* the cap, not before. Add discipline (already in place) prevents adding above target weight.
  3. **Favorable-skew test, quality variant.** Every add must name (i) the credible permanent-impairment scenario in one specific sentence, and (ii) the durability of the compounding from here. If impairment is credible and durability isn't clearly multi-year, default to hold. No vague "tech disruption" — name the mechanism (franchise erosion, balance-sheet event, terminal demand decline, regulatory ban).
  4. **Permanent loss vs. drawdown distinction.** On any position down >20% from cost, the response is framed around "is the *business* impaired or has the *multiple* compressed?" — pulled from filing analysis, transcripts, recent press releases. State which one before recommending hold. Different urgency, different action.
  5. **Tax-aware trim: pairing AND deferral.** On any trim recommendation in `NON_REGISTERED` / `JOINT_NON_REGISTERED` / `CORPORATE` accounts, the model must do TWO things before recommending: (a) call `get_tax_loss_harvest_candidates` and surface available losses to pair, and (b) quantify the tax cost in dollars at the user's marginal rate (50% inclusion × marginal rate, pulled from the tax profile — never assumed) and ask whether deferring the trim to the next tax year is acceptable. Tax-deferral is often a larger lever than TLH pairing; don't skip it. In registered accounts (TFSA/RRSP/FHSA/RESP/LIRA/RRIF), tax is ignored entirely.

**UI**
- None.

**Out of scope (deferred)**
- IPS cap fields themselves (Session 2)
- Theme-tagging UI (deferred indefinitely; theme inference stays qualitative)
- Cycle-temperature / regime-awareness language (no structured signal yet)
- Kelly / vol-target sizing prose (walked back — wrong for fundamental concentrated books)
- Mechanical trim-to-target prose (walked back — wrong for quality buy-and-hold)

**Files touched:** 1

**Done when:**
- Typecheck clean.
- The persona contains all five new principles in clear PM-style prose.
- A fresh chat asking "should I add to AVGO at this dip" pushes back on theme concentration, names the impairment scenario, and proposes the under-target bucket instead — without being given a hardcoded rule.

---

### Session 2 — IPS concentration caps

**Status:** shipped.

**Goal:** make the concentration cap from Session 1 a real config field the user controls — not a hardcoded constant in the persona.

**Schema deltas**
- `InvestmentPolicy.maxSingleNameWeightPct Decimal? @db.Decimal(5, 2)` — nullable. If null, persona refuses to make add recommendations until set; tells the user to configure it in Settings.
- `InvestmentPolicy.maxThemeWeightPct Decimal? @db.Decimal(5, 2)` — nullable. Same null-handling.
- `InvestmentPolicy.capReasoning String?` — optional free-text the user writes about why they picked these caps (e.g., "I sleep fine at 12% in a single name as long as it's a quality compounder; 30% in any single theme is my ulcer line"). Persona surfaces this when applying the cap so the user sees their own reasoning back.

**Modules**
- `lib/portfolio/investment-policy.ts` — extend `getInvestmentPolicy` to return the new fields. Validation: between 1.0 and 50.0 for each pct.
- `lib/ai/tools.ts` — `get_investment_policy` tool already returns the full IPS shape; no change needed beyond ensuring the new fields are in the projection.
- `lib/ai/persona.ts` — the Session 1 cap rule already references "the cap read from `InvestmentPolicy.maxSingleNameWeightPct`"; this session makes that reference concrete.

**UI**
- Settings → IPS: two new numeric inputs (per-name cap, per-theme cap) with a free-text reasoning field beneath. Inline help: "the persona will refuse to recommend adds above these caps; trims only happen *at* the cap, not before." Persist on blur.
- IPS overview card on the IPS page: show the caps alongside the bucket targets, with the user's reasoning shown as a small italic blockquote.

**Out of scope (deferred)**
- Per-theme tags on holdings (no structured theme model in this pass; persona infers themes qualitatively from theses + correlation matrix)
- A "what would trim X look like" preview button (Session 4 covers this in the Hub UI)

**Files touched:** ~5

**Done when:**
- Typecheck clean.
- Migration created and applied.
- Settings → IPS shows the two cap inputs; saving persists to the DB.
- A fresh chat about a position at 11% with cap=12% returns "still inside your cap, let it compound."
- A fresh chat with caps unset returns "you haven't set a single-name cap on your IPS — set one in Settings before I'll recommend size changes."

---

### Session 3 — Decision Hub schema (extends Alert system)

**Status:** shipped.

**Goal:** turn `AlertEvent` from a notification record into a decision-grade record. Add the structured fields needed to capture WHY each signal merits attention, WHAT to do, and WHAT HAPPENED. Add the new event sources (AI chat, reviews, manual) alongside the existing cron rule-based events. This is the foundational schema change everything else in the roadmap depends on.

**Schema deltas**
- New enum `AlertSource`: `CRON_RULE | AI_CHAT | DAILY_REVIEW | WEEKLY_REVIEW | ANNUAL_REVIEW | MANUAL`. Tracks WHERE the decision was raised. `CRON_RULE` is the existing flow.
- New enum `RecommendedAction`: `ADD | TRIM | EXIT | HOLD_THROUGH_DRAWDOWN | DEPLOY_ELSEWHERE | HARVEST_LOSS | REBALANCE | REVIEW_THESIS | NONE`. What the Hub entry suggests the user do.
- New enum `DecisionOutcome`: `OPEN | EXECUTED_AS_RECOMMENDED | EXECUTED_REVISED | ABANDONED | REJECTED | EXPIRED`. User-driven workflow state.
- New enum `DecisionUrgency`: `INFO | MATERIAL | URGENT`. Drives email digest filtering (reuses the existing severity convention from `PLATFORM_ACTIVATION_ROADMAP.md` Session 2).
- `AlertEvent` extended with:
  - `source AlertSource @default(CRON_RULE)` — backfill all existing rows to CRON_RULE
  - `recommendedAction RecommendedAction?` — nullable for legacy events
  - `actionDetails Json?` — structured spec of the recommendation: `{ ticker, quantity?, priceContext?, account? }`
  - `rationale String?` — 1-3 sentence WHY in PM voice
  - `sizingRationale String?` — 1-2 sentence WHY *this size* (separate from why this name). A real PM never logs "ADD 10 shares" without also logging "sized at 1.5% NAV, can absorb -50% to invalidation = 75bps drawdown contribution." Forces the model to think in NAV terms, not share-count terms.
  - `sizingDetails Json?` — structured: `{ nominalUsd, pctOfNav, maxLossToInvalidationUsd, maxLossToInvalidationPctOfNav, postTradePositionPctOfNav, postTradeBucketPctOfTarget }`. Lets the retrospective compute "did sizing match the documented framework?"
  - `supportingEvidence Json?` — snapshot of inputs at firing time (numbers, tool outputs, links). Frozen so it doesn't go stale.
  - `alternativesConsidered String?` — what was chosen over what (PM capital-allocation discipline)
  - `invalidationTrigger String?` — what would make this recommendation wrong (separate from thesis-level invalidation)
  - `reviewByDate DateTime?` — soft deadline; populated when the recommendation has a natural review event
  - `reviewEvent String?` — human-readable trigger ("Sept 2 print, criterion (a) clock")
  - `urgency DecisionUrgency @default(INFO)`
  - `conversationId String?` — FK to `AIConversation` when source = AI_CHAT
  - `reviewId String?` — FK to whatever review model is relevant when source = a review type
  - `outcome DecisionOutcome @default(OPEN)`
  - `outcomeExecutedQuantity Decimal?` — what the user actually did (e.g. recommended 10, executed 7)
  - `outcomeExecutedPrice Decimal?` — fill price
  - `outcomeNotes String?` — free-text "why I did what I did" or "why I walked away"
  - `outcomeRecordedAt DateTime?`
- `Alert.rule` enum extended with new ad-hoc kinds for non-cron sources: `AI_PROPOSED_DECISION`, `REVIEW_PROPOSED_DECISION`, `MANUAL_FLAG`. Each of these has a synthetic `Alert` row per user so AlertEvent FK stays valid; no scheduled cron checks fire for these rules — they're just a parent record for events from those sources.
- Index: `@@index([userId, outcome, urgency, firedAt(sort: Desc)])` for the Hub inbox query.

**Modules**
- `prisma/migrations/<ts>_decision_hub_schema/` — autogenerated migration with backfill SQL: all existing AlertEvents get `source=CRON_RULE`, `outcome=OPEN`, urgency set from the existing `severity` proxy if present.
- `lib/alerts/hub.ts` — new module. Pure helpers:
  - `createDecisionEvent(input)` — single write path used by all sources (cron, chat tool, review job, manual UI). Validates that `source` matches the FKs present (e.g. if source=AI_CHAT, conversationId is required).
  - `recordOutcome(eventId, outcome, details)` — closes the loop.
  - `listOpenDecisions({ userId, urgency? })` — the Hub inbox query, ordered by urgency DESC, firedAt DESC.
- `lib/alerts/engine.ts` (existing) — refactored to call `createDecisionEvent` for the cron-rule path so all sources go through one write path. Behavior identical.

**UI**
- None this session. Schema + write path only. UI lands in Session 4.

**Out of scope (deferred)**
- Hub inbox UI (Session 4)
- AI chat tool to propose decisions (Session 5)
- Review jobs emitting decisions (Session 5)
- Retrospective / batting-average computation (Session 6)

**Files touched:** ~6

**Done when:**
- Typecheck clean.
- Migration applied; existing AlertEvent rows all have backfilled source=CRON_RULE, outcome=OPEN.
- `createDecisionEvent` exists, has unit-test coverage for source/FK validation.
- The existing cron-rule alert flow uses `createDecisionEvent` and produces identical rows to before (plus the new fields, mostly null).

---

### Session 4 — Decision Hub UI (inbox + outcome recording)

**Status:** shipped. Post-Session-7 update: the inbox lives at `/alerts` (not `/decisions`). Alert rule configuration moved to `/alerts/rules`. The inbox shows both decision-grade and notification-only events in distinct sections.

**Goal:** ship the single page where the user works through pending decisions. Each card shows the recommendation, the supporting evidence (preserved at firing time), the trigger, and a "what did you do?" workflow that records the outcome manually.

**Schema deltas**
- None.

**Modules**
- `lib/alerts/hub.ts` — add `getDecisionCard(eventId)` returning the shape the UI needs (event + alert + linked conversation/review summary if present).
- `app/(app)/decisions/page.tsx` — server component listing open decisions grouped by urgency.
- `app/(app)/decisions/[id]/page.tsx` — detail view with the outcome-recording form.
- `app/actions/decisions.ts` — server action `recordDecisionOutcome` (wraps the lib helper).

**UI**
- Sidebar nav: rename "Alerts" → "Decisions" (or add "Decisions" if Alerts stays for the rule-config admin page). The Hub is the user-facing view; Alerts (the rule config) is the admin view.
- Decisions inbox page:
  - Three columns or sections grouped by urgency (URGENT, MATERIAL, INFO)
  - Each card: ticker pill, recommended-action badge, one-line rationale, source badge (CHAT / REVIEW / CRON / MANUAL), "Decide" button
  - Empty state: "Nothing needs your attention. The platform stays quiet when there's nothing to do."
- Decision detail page:
  - Header: ticker, action, urgency, firedAt
  - Body: rationale (1-3 sentences), supporting evidence rendered from the JSON blob (numbers in a small table, links to source filing/transcript when present), alternatives considered, invalidation trigger, review event + date
  - Source attribution: "Raised by AI chat on 2026-06-04 → [link to conversation]" or "Raised by weekly review → [link]" or "Cron rule: IPS_DRIFT_BREACH"
  - Outcome form: radio for `EXECUTED_AS_RECOMMENDED | EXECUTED_REVISED | ABANDONED | REJECTED`. If executed: numeric inputs for actual quantity + fill price + account dropdown. Free-text notes. Save closes the decision.
- Decision history: same page or sibling page showing closed decisions with outcome + notes. Filterable by ticker, by source, by outcome.

**Out of scope (deferred)**
- Editing the recommendation itself (decisions are immutable; if a follow-up needed, a new decision is raised)
- Bulk "approve all" actions (each decision is acknowledged individually — friction is the feature)
- Email/push notifications for new URGENT decisions (separate notification work)

**Files touched:** ~8

**Done when:**
- Typecheck clean.
- A new decision created via `createDecisionEvent` appears in the inbox.
- Clicking "Decide" → recording `EXECUTED_REVISED` with quantity 7 / price $408 / notes "didn't want to put the full $4k in one click" closes the decision and shows it in history.
- Empty-state copy renders when no OPEN decisions exist.

---

### Session 5 — Cross-medium wiring (AI chat + reviews → Hub)

**Status:** shipped in full. Initial cut shipped chat + manual paths; post-Session-7 architectural pass shipped (a) weekly + annual review auto-propose via the new `lib/ai/review-tools.ts`, (b) TLH + REBALANCE coaching rule upgrades to decision-grade, (c) chat UI pill `📌 Decision raised → view`. Thesis-invalidation cron deliberately stays notification-only because the implied action (trim vs exit vs hold) depends on context.

**Goal:** make every medium that today produces analysis route its actionable conclusions into the Hub. The AI chat gets a tool to propose decisions during a conversation. Daily/weekly/annual reviews emit decision events when they conclude something needs doing. Manual flags get a "raise a decision" affordance from any position or thesis page.

**Schema deltas**
- None — Session 3 schema covers it.

**Modules**
- `lib/ai/tools.ts` — new tool `propose_decision`. The AI persona calls this when its recommendation is concrete and time-bound enough to merit Hub tracking. Required arguments mirror the structured fields on `AlertEvent` (action, actionDetails, rationale, supportingEvidence, alternativesConsidered, invalidationTrigger, reviewEvent?, reviewByDate?, urgency). The tool synthesizes a `createDecisionEvent` call with `source=AI_CHAT` and `conversationId` from the current chat context.
- `lib/ai/persona.ts` — extend with a short "When to propose a decision" rule: the model proposes a decision when it has made a specific, ticker-bound, action-bound recommendation (not for general discussion). It does NOT propose decisions for hold-and-do-nothing answers. When it does propose one, it tells the user inline ("I've raised this in your Decisions inbox").
- `lib/ai/reviews.ts` — extend the daily/weekly/annual review prompts with the same `propose_decision` capability. When a review identifies a specific actionable item (e.g. IPS drift breach with a concrete trim list, thesis-criterion-fired), it emits a decision event with `source = <REVIEW_TYPE>` and `reviewId` populated. Reviews already emit free-text analysis; this session captures the *actionable subset* into structured rows.
- `lib/alerts/cron-jobs.ts` (or wherever the existing cron rules live) — for each existing rule, ensure the emitted event carries `recommendedAction`, `rationale`, `supportingEvidence`, and `urgency`. Today many rules just produce a `message` string — this session promotes them to decision-grade.
- Position page + Thesis page: add a "Raise a decision" affordance (popover with a short form) → writes `source=MANUAL`. Use case: user reads a position and decides "I want this in my decision queue with my own note" without going through the chat.

**UI**
- Position page: small "Raise a decision" button in the header actions menu.
- Thesis page: same.
- AI chat message footer: when an assistant message produced a `propose_decision` tool call, show a small inline pill "Decision raised → [view]" linking to the Hub entry.

**Out of scope (deferred)**
- Auto-proposing decisions from cron-only data (the cron-rule path is already automatic — this scope is just adding the rich fields)
- Decision-deduplication logic (e.g. don't raise the same AVGO-add decision from chat if one fired from cron in the last 24h) — defer to Session 6 if it turns out to matter

**Files touched:** ~10

**Done when:**
- Typecheck clean.
- A chat where the model says "I'd add 10 AVGO at ~$410" produces a Hub entry with source=AI_CHAT, conversationId set, structured action + rationale.
- A weekly review that flags "PLTR trimmed to bring US Growth back to target" produces a Hub entry with source=WEEKLY_REVIEW.
- An existing IPS-drift-breach cron alert produces a Hub entry with `recommendedAction=REBALANCE`, populated rationale, and the drift numbers in supportingEvidence.
- Manually clicking "Raise a decision" on a position page lets the user create a Hub entry without going through chat.

---

### Session 6 — Retrospective + self-grading

**Status:** shipped. Now lives at `/alerts/retrospective`. Per-ticker decision-history sidebar also ships on the alert detail page so the chat persona's `get_decision_history` and the UI surface complementary views.

**Goal:** once the Hub has been collecting decisions for a few weeks, surface the patterns. Hit rate, decision-to-execution rate, decisions abandoned by source, time-to-decide. This is what makes the journal worth keeping — a place to look in the mirror.

**Schema deltas**
- None — derives from existing Hub data.

**Modules**
- `lib/alerts/retrospective.ts` — pure computation over closed `AlertEvent` rows:
  - `getHitRate({ userId, sinceMonths, byAction?, bySource? })` — for ADD/TRIM/EXIT decisions, did the position's value improve vs. the decision's recommendation over the next 30/90/180/365 days? Requires holding price history (already in `EodSnapshot` or similar).
  - `getCounterfactualOnAbandoned({ userId, sinceMonths })` — for ABANDONED decisions, what would the outcome have been if executed? Computed against EOD price history at the decision's `actionDetails.priceContext` and current/marked price. The single most important learning signal: if abandoning is consistently saving money, your discipline is working; if it's leaving money on the table, the persona's bar might be calibrated wrong or your own restraint is misfiring. Surface as "if you'd executed your last 10 abandoned ADDs, you'd be ±$X."
  - `getExecutionRate({ userId, sinceMonths, bySource? })` — what % of recommendations from each source got EXECUTED vs ABANDONED? High abandonment from AI_CHAT might mean the persona is too aggressive; high abandonment from CRON_RULE might mean rules are too noisy.
  - `getDecisionLag({ userId })` — distribution of `outcomeRecordedAt - firedAt`. Long lags mean stale decisions.
  - `getDriftAttribution({ userId, asOf })` — separates IPS bucket drift into **passive drift** (caused by price moves on existing positions) and **active drift** (caused by your trades since the last snapshot). The psychological + risk meaning is completely different. "+5pp tech because the names compounded" requires a trim conversation; "+5pp tech because you added five times" requires a behavioral conversation. Computed by comparing today's bucket weights vs. a counterfactual portfolio where no trades happened since N months ago.
  - `getActionPatterns({ userId })` — flag recurring patterns like "AVGO appears as recommended ADD in 4 of last 6 months — anchoring?" or "every URGENT decision in the last 90 days has been ABANDONED — are URGENT rules calibrated wrong?"
- `lib/ai/tools.ts` — `get_decision_history(ticker?, sinceMonths?)` so the chat persona can ground its current recommendation in the user's track record on this name.
- `lib/ai/persona.ts` — short addition: when proposing a decision the persona has flagged before for the same ticker, surface that fact explicitly ("I recommended ADD on AVGO on 2026-06-04 and you ABANDONED — context here, is the same logic applying or is something different?").

**UI**
- New page `app/(app)/decisions/retrospective/page.tsx`:
  - Tiles: total decisions raised, hit rate by action, execution rate by source, median decision lag, abandoned-counterfactual P&L ("if you'd executed your abandoned ADDs you'd be ±$X").
  - Drift attribution panel: side-by-side bars for each IPS bucket showing actual drift split into passive (price moves) vs active (your trades) components.
  - Recent abandoned-recommendation list with the user's notes — the single highest-value data for catching pattern errors in either the persona or the user's own behavior.
  - Pattern callouts ("you've abandoned 80% of recommended ADDs in the last 90 days — either the persona is too eager or you're appropriately disciplined; review the rationales").
- Decision detail page (from Session 4): "previous decisions on this ticker" sidebar showing chronological history.

**Out of scope (deferred)**
- Benchmark-relative attribution (the universe of "what would have happened if you didn't act" is hard without a counterfactual model)
- ML pattern detection (start with simple heuristics; only get fancy if the simple ones surface nothing useful)

**Files touched:** ~7

**Done when:**
- Typecheck clean.
- Retrospective page renders with at least: total decisions, execution rate by source, hit rate by action, decision-lag distribution, abandoned-counterfactual P&L, and passive-vs-active drift attribution per bucket.
- A chat about AVGO surfaces "previously: ADD recommended 2026-06-04, outcome ABANDONED, your notes were '...'".

---

### Session 7 — Conviction re-rating discipline

**Status:** shipped. Conviction-decay cron emits **notification-only** events (no `recommendedAction`), per the post-Session-7 "no fake action labels" principle — the user re-rates or raises a manual trim/exit decision themselves. Conviction pill also lands on the thesis list page (color-coded, with stale indicator).

**Goal:** force periodic re-rating of conviction on every held position so quietly-decaying conviction doesn't go undetected. Real PMs run quarterly conviction reviews on every name; without this, you can hold a position for years on enthusiasm that quietly evaporated 18 months ago, and the system has no way to catch it. Decay-without-action becomes a first-class Hub signal.

**Schema deltas**
- `Thesis.convictionRating Int?` — 1-10 scale. 1 = "I'd exit if I were starting fresh today." 10 = "highest-conviction name in the book." Nullable so legacy theses don't break; persona prompts for an initial rating on first interaction with an unrated thesis.
- `Thesis.convictionRatedAt DateTime?` — when the current rating was set.
- `Thesis.convictionNotes String?` — short free-text written at re-rate time. Captures *why* the conviction moved (e.g., "raised from 6 to 8 after Q2 print confirmed Azure margin expansion thesis").
- `ConvictionHistory` table — `(thesisId, rating, notes, ratedAt, source AlertSource)` — audit trail. Lets the retrospective track conviction *trajectory* per name, not just current value.

**Modules**
- `lib/portfolio/thesis.ts` — `recordConvictionRating(thesisId, rating, notes, source)` writes to both the Thesis (current) and ConvictionHistory (audit). Validation: 1-10 integer, notes required for any change of ≥2 points.
- `lib/ai/tools.ts` — `get_thesis_conviction(ticker)` returns current rating + age + trajectory (last 4 ratings). `record_conviction_rating(...)` lets the chat persona write a rating when the user gives one in conversation.
- `lib/ai/persona.ts` — short addition: when a thesis is referenced in a chat, if the rating is null or older than 90 days, the persona asks for a fresh rating before continuing the analysis. "Your AVGO thesis was last rated 8/10 in February — six months ago. Where are you on it today? Same? Lower? I'll ground the rest of this conversation in the current view."
- `lib/alerts/conviction-decay.ts` — new cron-rule check: for any thesis with `convictionRatedAt` older than 90 days, emit a Hub decision event with `source=CRON_RULE`, `recommendedAction=REVIEW_THESIS`, urgency=INFO. For any thesis where the trajectory shows a decay from ≥8 to ≤5 without an EXIT or TRIM decision in the same window, urgency=MATERIAL.

**UI**
- Thesis page: prominent conviction rating display with last-rated date. "Re-rate" button opens a short form (slider + notes textarea). History sparkline showing trajectory.
- Thesis list / portfolio page: small conviction pill next to each name (color-coded: green ≥7, yellow 4-6, red ≤3, grey for null/stale).
- Settings → Behavioral patterns: surface "average days since last conviction re-rate" as a discipline metric.

**Out of scope (deferred)**
- ML-driven conviction inference from chat content (start with explicit user input; only get fancy if explicit input is consistently skipped)
- Per-criterion conviction (rating each invalidation criterion separately) — overkill for v1; the overall name-level rating is the discriminator that matters

**Files touched:** ~8

**Done when:**
- Typecheck clean.
- Migration applied; existing theses have null ratings + null rated-at, no breakage.
- Re-rating a thesis writes both Thesis (current) and ConvictionHistory (audit) rows.
- A chat referencing a stale thesis is interrupted by the persona asking for a fresh rating.
- The conviction-decay cron fires a Hub entry for any thesis ≥90 days unrated.
- A drop from 8 → 4 over two re-rates without a TRIM/EXIT decision produces a MATERIAL Hub entry.

---

## 3. Post-Session-7 architectural pass

After the 7-session sequence shipped, the user surfaced three corrections that required cross-cutting work. All shipped in one batch.

### Routes merged: `/alerts` is the single inbox

Two URL routes for what was conceptually one queue was a UX mistake. Consolidated:

- `/decisions/*` → deleted
- `/alerts` → the unified inbox. Decision-grade events (with `recommendedAction`) appear up top with action affordances and outcome workflow; notification-only events sit underneath with a Mark-as-read affordance.
- `/alerts/rules` → the alert rule configuration page (moved from the old `/alerts` root).
- `/alerts/[id]` → branches on `recommendedAction`. Decision-grade renders the outcome form; notification-only renders a "Mark as read" panel.
- `/alerts/history`, `/alerts/retrospective` → moved over.
- Nav has a single "Alerts" entry, not two.
- The `propose_decision` tool's return URL, the chat UI pill, and all server-action `revalidatePath`s point at `/alerts/{id}`.

### Daily review killed

Real portfolio managers work weekly. There was no daily-review cron scheduled (only on-demand), but the `DAILY_PERSONA`, `generateDailyReview`, and `aiAutoDailyReview` path existed and made the surface area noisier than it deserved. Deleted:

- `app/api/cron/daily-review/` route
- `DAILY_PERSONA` + `generateDailyReview` in `lib/ai/reviews.ts`
- `generateDailyReviewAction` in `app/actions/reviews.ts`
- `getLatestAnalysis` narrowed to `"WEEKLY"` only
- Dashboard `PMReadCard` now generates a weekly review on demand (button label: "Generate weekly review")

The `aiAutoDailyReview` preference field is left on the User row for backwards compatibility; it's a no-op now.

### Forced `REVIEW_THESIS` action dropped

Notification-grade rows were being shoehorned into a fake "Review thesis" action just to give them a button. Removed:

- Conviction-decay events (both stale-conviction and decay-from-high-to-low) now emit with `recommendedAction = null` — they're notifications. The user re-rates conviction or raises a trim/exit decision themselves.
- `REVIEW_THESIS` removed from the chat `propose_decision` tool enum.
- `REVIEW_THESIS` removed from the `RaiseDecisionButton` dropdown.
- Enum value preserved in schema for backwards compatibility with any rows that might reference it.
- The thesis-invalidation filings cron deliberately remains notification-only as well, for the same reason: implied action depends on context (TRIM vs EXIT vs hold-and-watch).

### Auto-propose wired into weekly + annual reviews

Reviews now write structured Hub decisions for specific actionable items via the new `lib/ai/review-tools.ts` helper:

- `buildReviewProposeTool({ userId, source, reviewId })` returns a `propose_decision` tool bound to a review's `AIAnalysis` row.
- Both `generateWeeklyReview` and `generateAnnualReview` pre-create the `AIAnalysis` row (so the tool can reference its ID), pass the bound tool into `streamChat`, and update the body once streaming completes. If the review is skipped (`NO_REVIEW_NEEDED` sentinel) or produces no body, the placeholder row is deleted.
- Personas extended with a "When to call propose_decision" rule: only for specific actionable items with a concrete trade, never for "worth watching" commentary or IPS-level commitments.

### TLH + REBALANCE coaching upgraded to decision-grade

The two unambiguous coaching rules now write full decision-grade rows:

- `TlhFiredEvent` carries `HARVEST_LOSS` action + sizing details + rationale + invalidation trigger (the superficial-loss rule) + `reviewByDate` set to tax year-end. Urgency `URGENT` within 30 days of year-end, else `MATERIAL`.
- `RebalanceFiredEvent` carries `REBALANCE` action + drift attribution + mirror-bucket details + rationale.
- `signals/evaluate.ts` passes all decision-grade fields through `createDecisionEvent`.

### Chat decision pill

Server emits a `decision_raised` SSE event after a successful `propose_decision` tool call; chat UI renders an inline `📌 Decision raised → view` pill linking to `/alerts/{id}`. Complements the inline mention the persona already makes in its reply.

---

## 4. Cross-session notes

**Why Alerts becomes the Hub rather than a parallel concept.** The existing Alert/AlertEvent infrastructure already has the right shape (per-user, per-ticker, structured payload, read/unread state, firing log). Adding decision-grade fields on top is a smaller change than introducing a parallel `Decision` model and keeping them in sync. The "Alert" naming on the *rule* side stays sensible; the user-facing surface becomes "Decisions" because that's what they are by the end of Session 4.

**Why outcomes are manual.** Trade entry is manual in this app — there's no broker feed. Auto-reconciliation between a Transaction and an open decision would require fuzzy matching on ticker + quantity + date + price, which gets wrong often enough that the user wouldn't trust it. Manual outcome entry is a few clicks at decision time and produces clean data. The friction is the feature.

**Why no Kelly / vol-targeting / regime overlay.** Per the external research and chat-log audit, these are either wrong for fundamental concentrated books (Kelly), not relevant for this user's tax-deferred constraints (vol-targeting), or actively disclaimed by the practitioners this user's style emulates (regime forecasting per Buffett/Smith/Train). Marks-style cycle-temperature *awareness* could land in a future session if a structured signal becomes available.

**What this roadmap does NOT do.** It doesn't add new analysis tools (the existing tool set is good). It doesn't restructure the AI chat itself (the persona changes are the only chat work). It doesn't try to grade the AI's recommendation quality with backtests (Session 6 grades outcomes you recorded, which is downstream and trustworthy). It deliberately avoids any path that would auto-execute trades or auto-record decisions on the user's behalf — the advisor-not-executor principle binds everywhere.

**Explicitly considered and deferred** (so they don't sneak back into scope unstated):
- **Kelly / fractional Kelly / vol-targeting sizing** — wrong for fundamental concentrated long-only books per AlphaTheory + Acadian research. Sizing in Session 3 is conviction-weighted inside hard caps, not formula-driven.
- **Mechanical trim-to-target rebalancing** — wrong for quality buy-and-hold per Buffett/Lynch. Session 1's hard cap permits letting winners run inside the cap rather than mechanical rebalance.
- **Top-down macro / regime forecasting overlay** — Buffett/Smith/Train explicitly disclaim it. Persona can read cycle-temperature as a hurdle-rate bias *if* a structured signal becomes available; no language for macro calls is added.
- **Daily reviews / daily anything** — PMs work weekly. Killed entirely in the post-Session-7 pass. The on-demand "PM's read" is the only retained surface.
- **A separate `/decisions` route** — rejected in the post-Session-7 pass. One queue, one URL (`/alerts`). Decision-grade and notification-only events share the inbox but are visually distinct.
- **Auto-action on every event** — events without a concrete trade implication (stale-conviction, conviction decay, thesis-invalidation candidate from filings, news flags) stay notification-only. We do not manufacture a `REVIEW_THESIS` placeholder so every row has a button.
- **Behavioral-patterns settings sub-page** — the `panicSell` / `fomoBuy` / `overtrading` thresholds live inside `PolicyEditor`. The "avg days since last conviction re-rate" metric was scoped but has no natural home today; revisit if a dedicated behavioral-discipline page lands.
- **Thesis page mirror of "Raise a decision"** — `RaiseDecisionButton` already lives in the position page aside next to `ThesisCard`, which is the only thesis surface. Adding a duplicate elsewhere is noise.
- **ADV / liquidity awareness per position** — only matters if the user holds illiquid small-caps; current book is mega-cap quality. Revisit if portfolio composition changes.
- **Formal ex-ante volatility risk budget** — institutional/quant discipline, not load-bearing for this style.
- **Portfolio FX exposure as a separate dimension** — relevant but not currently a decision driver; user isn't currency-hedging. Note as future concern.
- **Decision dependencies / conditional decision chains** ("execute B only if A first") — too complex for v1; manual handling in `outcomeNotes` is sufficient.
- **Rolling expected-return estimates per position** — too quantitative for quality-compounder style; favorable-skew test in Session 1 captures the spirit.
- **Opportunity-cost-driven sells** ("would I buy this today at this price?") — high friction; revisit if Hub usage suggests demand.
- **Auto-reconciliation between Transaction and open decisions** — trade entry is manual; fuzzy matching would be wrong often enough to break trust. Manual outcome entry in the Hub UI is the contract.
