# Investment Manager — Plan

> Living source of truth. Update when a decision changes; don't let this drift from reality.

**Last touched:** 2026-05-31 · **Phase:** 6 done; app feature-complete for v1

---

## 1. Vision

A clean, premium-feeling personal portfolio manager for **a single user**, focused on **long- and medium-term US equity positions** (not day trading). Manual transaction entry; rich position detail; 15-minute-delayed quotes; AI guidance that **thinks like a portfolio manager**, not a chatbot — with strict cost discipline.

Reference design: Coinbase. Dark, sidebar nav, two-column position detail, big numbers, calm. (See `bitcoin.html` at repo root.)

### Non-goals (v1)
- Trading execution (no broker API)
- Real-time tick data (15-min delayed is fine)
- Options, crypto, international equities
- Multi-user / sharing / team features
- Mobile native apps (responsive web is enough)
- Tax-grade lot accounting (FIFO only; no wash-sale detection)
- Backwards compatibility — this is a fresh single-user app

---

## 2. Stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.2.6** | Turbopack default, async `params`, `'use cache'`, `proxy.ts` |
| UI | **React 19.2.4** | Actions, `useActionState`, `use()` |
| Styling | **Tailwind v4** | CSS-first `@theme inline`, no JS config |
| Auth | **Better Auth 1.6** | Magic-link only; Prisma adapter; cookie cache enabled |
| ORM | **Prisma 7.8** | Driver adapter (`@prisma/adapter-pg`); URL-less schema |
| DB | **Supabase Postgres** (ca-central-1) | Pooled at `:6543` for runtime; Supavisor session at `:5432` for migrations |
| Email | **Mailgun** (eventually) | Dev fallback logs link to console |
| AI | **OpenAI SDK** primary (Vercel AI SDK rejected — too much lock-in); thin in-house `AiProvider` interface in `lib/ai/types.ts`. Three provider options: `openai` (cloud), `azure-openai` (same SDK's `AzureOpenAI` client; deployment name = `AI_MODEL`), `anthropic` (stub, ready to fill in). Swap is one env var. |
| Market data | **Finnhub** (quotes / news / fundamentals) + **`yahoo-finance2`** (candles) | 60 req/min free; Finnhub's `/stock/candle` is paywalled, so Yahoo handles bars |
| Background | **Vercel Cron** | Free tier sufficient; up to ~40 jobs/day |
| Hosting | **Vercel** | Mac dev, Vercel prod |
| Money types | `Decimal(18,4)` for $, `Decimal(18,6)` for qty | Convert to `number` at the render boundary |

### Versions pinned at session start
- `next@16.2.6`, `react@19.2.4`, `prisma@^7.8.0`, `@prisma/client@^7.8.0`, `@prisma/adapter-pg`, `pg`, `better-auth@^1.6.12`, `dotenv@^16`, `tailwindcss@^4`, `typescript@^5`

---

## 3. Architecture (module shape)

```
app/
  (auth)/                    public — no shell, centered card
    layout.tsx
    sign-in/page.tsx
  (app)/                     gated — sidebar + topbar shell
    layout.tsx               auth.api.getSession() — redirect if missing
    page.tsx                 Dashboard
    portfolio/
    watchlist/               (placeholder)
    markets/                 (placeholder)
    transactions/            (Phase 2 → real)
    chat/                    (placeholder; Phase 4)
    alerts/                  (placeholder; Phase 5)
    settings/                (placeholder)
    positions/[ticker]/      The page. Coinbase clone.
  api/
    auth/[...all]/route.ts   Better Auth handler (toNextJsHandler)
    ai/chat/route.ts         (Phase 4) SSE streaming
    cron/                    (Phase 5+)
      refresh-quotes/
      eod-snapshot/
      eod-review/
      weekly-review/
      run-alerts/
components/
  sidebar.tsx                client — usePathname active state
  topbar.tsx                 async server — reads session
  user-menu.tsx              client — dropdown + sign-out
  sign-in-form.tsx           client — magic link form
  charts/price-chart.tsx     custom SVG, SSR-safe, deterministic mock seed
  range-pills.tsx, sub-tabs.tsx, ai-card.tsx, transaction-panel.tsx,
  empty-state.tsx, icons.tsx
lib/
  prisma.ts                  Prisma singleton via @prisma/adapter-pg
  auth.ts                    Better Auth server
  auth-client.ts             Better Auth React client
  mailgun.ts                 Magic-link email + console fallback
  mock.ts                    (Phase 0/1 only — retired in Phase 2)
  format.ts                  currency/percent helpers
  portfolio/                 (Phase 2+)
    holdings.ts              FIFO derivation: transactions → positions
    metrics.ts               P&L, allocation, beta (later)
  marketdata/                (Phase 3)
    index.ts                 provider-agnostic façade
    finnhub.ts, alpaca.ts, cache.ts
  ai/                        (Phase 4)
    client.ts                Anthropic + caching headers
    tools/                   Zod-typed tools
    persona.ts               system prompt
    snapshot.ts              portfolio snapshot builder
  signals/                   (Phase 5)
    rules.ts                 MA cross, volume spike, drawdown, etc.
    evaluate.ts
prisma/
  schema.prisma              Better Auth tables + (Phase 2+) domain models
  migrations/
generated/
  prisma/                    Prisma 7 generated client (gitignored)
proxy.ts                     Cookie-based redirect — UX only, server is source of truth
next.config.ts               serverExternalPackages: better-auth, kysely, @prisma/*, pg
prisma.config.ts             Prisma 7 — loads .env.local + .env; DIRECT_URL for migrate
.env.example                 Template (placeholder values)
.env.local                   Real secrets (gitignored)
docs/PLAN.md                 This file
bitcoin.html                 Visual reference
```

### Cross-cutting rules
- **Strict module boundaries.** `lib/marketdata` and `lib/ai` never touch Prisma. Route handlers and crons compose them.
- **Server-side auth enforcement** in `(app)/layout.tsx`. `proxy.ts` is convenience for UX (instant redirect on cookie absence) — never the security boundary.
- **No RLS.** Single user, Prisma connects as service role, attack surface is non-existent. Re-enable if multi-user or Supabase JS client gets added.
- **All money in Decimal at the DB layer**, converted to `number` at the render boundary. Decimal math in JS only when accumulating many lots.

---

## 4. Data model

### 4.1 Auth tables (Phase 1, deployed)
| Model | Owner | Notes |
|---|---|---|
| `User` | Better Auth | id, email, name, image, emailVerified |
| `Session` | Better Auth | rolling 30d expiry, cookie cache 5min |
| `Account` | Better Auth | OAuth + passwords (we use neither yet; reserved) |
| `Verification` | Better Auth | Magic-link token storage |

### 4.2 Portfolio tables (Phase 2, building now)
| Model | Notes |
|---|---|
| `Brokerage` | id, userId, name ("IBKR Taxable"), currency. Auto-create "Main" on first txn. |
| `Transaction` | Immutable ledger. id, userId, brokerageId, ticker, kind, quantity, price, fees, occurredAt, note, splitRatio. Indexed on `(userId, ticker, occurredAt)`. |
| `TransactionKind` enum | BUY, SELL, DIVIDEND, SPLIT, TRANSFER_IN, TRANSFER_OUT |

Holdings are **derived** from transactions via FIFO — not stored. A pure function in `lib/portfolio/holdings.ts` produces them on demand. Cheap at single-user scale; if it ever gets slow, materialize.

### 4.3 Market data tables (Phase 3)
| Model | Notes |
|---|---|
| `Quote` | ticker (PK), price, changePct, asOf, source. Refreshed by cron. |
| `PriceBar` | (ticker, timeframe, ts) PK. Historical bars for charts. Backfilled lazily on first position view. |
| `NewsItem` | id (provider id), ticker, headline, url, source, publishedAt, summary, aiSeverity |
| `Fundamentals` | ticker (PK), marketCap, peTtm, forwardPe, dividendYield, beta, 52wHigh/Low, nextEarnings |
| `PortfolioSnapshot` | (userId, ts) — daily total value snapshot written by EOD cron |

### 4.4 AI + Alerts (Phase 4+)
| Model | Notes |
|---|---|
| `AIConversation` | scope (PORTFOLIO/TICKER), title, createdAt |
| `AIMessage` | role (USER/ASSISTANT/TOOL), content (JSON), token usage |
| `AIAnalysis` | kind (EOD_DAILY/WEEKLY/ON_ALERT), body markdown, generatedAt |
| `Alert` | scope, ticker?, rule, params (JSON), channels (JSON), enabled |
| `AlertEvent` | alertId, firedAt, data, aiSummary, read |

---

## 5. AI engineering (Phase 4)

### Modes
| Mode | Model | Cadence | Cost target |
|---|---|---|---|
| Interactive chat | **Haiku 4.5** | On demand | $0.003/turn after caching |
| Daily review | **Sonnet 4.6** (effort=medium) | 16:30 ET trading days | ~$0.075/day |
| Weekly deep-dive | **Opus 4.7** (effort=high, adaptive thinking) | Sunday 09:00 ET | ~$0.55/week |
| Alert explainer | **Haiku 4.5** | On alert fire | ~$0.001/event |

**Realistic monthly bill: ~$6.50.** Headroom to $20.

### Prompt caching
- Order: **tools → system → portfolio snapshot (1h ephemeral cache_control) → user message**
- Tools sorted by name (deterministic)
- System prompt frozen — never interpolate dates or session IDs into it; inject those after the cached snapshot

### Tools (Zod-typed)
`get_quote`, `get_price_history`, `get_news`, `get_fundamentals`, `get_my_position`, `get_my_portfolio`, `get_transaction_history`, `get_realized_gains`, `get_dividend_history`, `get_sector_exposure`, `compute_correlation`, `web_search` (Anthropic-managed)

### Persona (locked, do not edit casually)
```
You are a portfolio manager for a single retail investor. You provide research, not advice.

Reason in this order, always:
  1. What changed.
  2. Why it matters for THIS specific portfolio (cite positions by ticker).
  3. What the downside / invalidation case is.
  4. Only then, if asked, what actions are worth considering.

Default time horizon: multi-year. Mention short-term only when explicitly asked.

Never give a bare buy/sell call. Always include thesis, key invalidating evidence,
and a confidence level. End buy/sell discussions with "This is research, not advice."

Quotes/prices/fundamentals: always fetch with tools. Never quote from memory.
Be concise. Dense paragraphs over bullet lists. No "as an AI" framing.
```

---

## 6. Signals & alerts (Phase 5)

Order of build:
1. `PRICE_MOVE` — > X% in 1 day (user-set)
2. `DRAWDOWN` — position down >X% from avg cost
3. `MA_CROSS_50` / `MA_CROSS_200`
4. `VOLUME_SPIKE` — >3× 30-day avg + same-day move
5. `CONCENTRATION` — single position >25% of portfolio
6. `EARNINGS_NEAR` — within 7 days
7. `NEWS_MATERIAL` — AI classifier on incoming news

Cadence: every 30 min during market hours; 06:00 + 22:00 ET off-hours.

Channels: in-app v1; email v1 (Mailgun); web push v2.

---

## 7. Cron map (Phase 5+)

| Job | Cadence | What |
|---|---|---|
| `refresh-quotes` | 15 min mkt hours, hourly off | Update `Quote` for holdings + watchlist |
| `refresh-news` | 30 min mkt hours | Pull Finnhub news, dedup, classify severity |
| `eod-snapshot` | 16:15 ET trading days | Write `PortfolioSnapshot` |
| `run-alerts` | 30 min mkt hours, 06:00/22:00 ET | Evaluate rules, write events, notify |
| `eod-review` | 16:30 ET trading days | Sonnet 4.6 daily note |
| `weekly-review` | Sunday 09:00 ET | Opus 4.7 deep-dive |
| `refresh-fundamentals` | weekly | Fundamentals + earnings dates |

Each cron route checks `process.env.CRON_SECRET` against the `authorization` header.

---

## 8. Build phases

| Phase | Status | What |
|---|---|---|
| 0 — Shell + design system | ✅ Done | Dark Coinbase theme, sidebar/topbar, custom SVG chart, dashboard/position detail with mock data, all routes wired |
| 1 — Auth + Prisma | ✅ Done | Better Auth magic link, Supabase Postgres, `proxy.ts` + server-side gate, user menu with sign-out |
| 2 — Real transactions | ✅ Done | Brokerage + Transaction models, transaction-entry form, FIFO holdings derivation, rewire pages to real data |
| 3 — Market data | ✅ Done | Quote/News/Fundamentals/Candle tables, TTL-aware cache layer, Finnhub adapter for quote/news/fundamentals, Yahoo Finance for candles, dashboard + portfolio + position pages all consume live data with graceful fallback |
| 4 — AI chat | ✅ Done | Provider-neutral `AiProvider` interface (`lib/ai/types.ts`), OpenAI adapter, 6 tools (quote/news/fundamentals/portfolio/position/transactions), PM persona system prompt, SSE-streaming `/api/ai/chat` route, full chat UI with tool-use chips, conversation persistence, light/dark themed |
| 5 — Alerts engine | ✅ Done | Alert + AlertEvent schema, signal engine (**PRICE_MOVE / DRAWDOWN / CONCENTRATION / MA_CROSS_50 / MA_CROSS_200 / VOLUME_SPIKE / NEWS_MATERIAL**), Vercel Cron (5 jobs), /alerts page, notification badge, **Mailgun digest emails** for `EMAIL`-channel alerts, **AI news classifier** (INFO/MATERIAL/CRITICAL via hourly cron, gated by user preference) |
| 6 — Scheduled AI | ✅ Done | AIAnalysis schema, daily review (21:15 UTC Mon–Fri) + weekly review (Sunday 13:00 UTC) crons, dashboard PM's read card surfaces latest, "Regenerate" manual trigger |
| 7 — Polish | ✅ Done | Watchlist, Markets, Settings (collapsible + Mailgun status + test email + **per-user preference toggles**), mobile responsive pass, toasts, transaction edit, brokerage management, conversation list, loading states, allocation donut, stop-generating, search bar, **SETUP.md** |

---

## 9. Decisions log (chronological)

- **2026-05-29 — Build order:** UI shell first (Phase 0), then auth (Phase 1). Reason: locked the visual design against the Coinbase reference before any backend coupling.
- **2026-05-29 — No Managed Agents (Anthropic).** User pushback; plain SDK in cron is enough and we keep full control.
- **2026-05-29 — Vercel hosting + Mailgun for email.** User-specified.
- **2026-05-29 — USD-only v1.** Currency/CAD reporting deferred to v1.5+.
- **2026-05-29 — Supabase Postgres in `ca-central-1` (Montreal).** Project name not set; ref `tvfqhnvcukcjkdebqcnt`. $10/mo on Fluent org Pro plan. User declined Neon free-tier alternative.
- **2026-05-29 — Skip RLS.** Single user; Prisma connects as service role; attack surface non-existent.
- **2026-05-29 — `DIRECT_URL` uses Supavisor session mode (port 5432), not direct DB host.** Direct host is IPv6-only on free Supabase; pooler session mode supports DDL.
- **2026-05-29 — `serverExternalPackages` for `better-auth`, `kysely`, `@prisma/*`, `pg`.** Required to stop Turbopack choking on Better Auth's Kysely transitive imports.
- **2026-05-29 — Holdings derived (not materialized).** Pure FIFO function on each render; cheap at single-user scale.
- **2026-05-29 — Yahoo Finance for historical bars.** Finnhub's `/stock/candle` is paywalled on the free tier. `yahoo-finance2` (community package, well-maintained) covers it; if Yahoo's API changes underneath us, we'll evaluate Alpaca or pay for Finnhub Pro. Added to `serverExternalPackages` in `next.config.ts`.
- **2026-05-29 — Lazy-fetch market data, no cron yet.** First page load that touches a new ticker hits the network; subsequent loads within the TTL hit the DB cache. Refresh cron is deferred to Phase 5 alongside alerts.
- **2026-05-29 — Quote TTL 60s, News 30min, Fundamentals 24h, Candles 12h.** All enforced in code (in `lib/marketdata/index.ts`), not the DB.
- **2026-05-30 — No Vercel AI SDK.** User pushback on Vercel lock-in. Wrote a thin `AiProvider` interface (~50 LOC) + minimal SSE protocol instead. The OpenAI adapter is ~180 LOC. Switching to Anthropic later means filling in `lib/ai/providers/anthropic.ts` against the same interface (no other code changes).
- **2026-05-30 — OpenAI by default, model `gpt-4o-mini`.** Env-var configurable: `AI_PROVIDER` + optional `AI_MODEL`.
- **2026-05-30 — Azure OpenAI support added.** `openai` SDK ships an `AzureOpenAI` client with the same `chat.completions` surface, so streaming logic is shared between `openai` and `azure-openai` (`OpenAiCompatibleProvider` class, two factory functions). On Azure, `AI_MODEL` is the *deployment name*, not the underlying model id.
- **2026-05-30 — Simple message storage.** One `AIConversation` per scope (`portfolio` for now). One `AIMessage` row per logical message (`user` | `assistant` | `tool`); tool calls are bundled into the assistant message's `content.toolCalls` field, results stored as separate `tool` rows. The UI hides raw tool rows and shows chips on the assistant message.

---

## 10. Risks the user should remember

1. **Bleeding-edge stack.** Next 16, React 19, Tailwind 4, Prisma 7 are all fresh; expect occasional rough edges.
2. **Finnhub free tier shrinks over time.** `lib/marketdata` façade lets us swap providers.
3. **15-min delayed quotes are not "live."** Acceptable since this is for long/medium-term decisions.
4. **Cost basis math is FIFO only.** No specific-lot selling, no wash-sale detection.
5. **Supabase free pooler.** If we outgrow free Postgres compute, we pay.
6. **Mailgun not set up.** Magic links print to dev console in dev. Real email needs domain + key before deploy.

---

## 11. Open questions

- Domain for Mailgun sending (when we set it up).
- Vercel deployment target — separate project, custom domain, or Vercel-hosted subdomain to start?
- After Phase 3, do we want push notifications for alerts, or email-only?

---

## 12. Conventions

- **No emojis in code.**
- **Comments are rare** — only for non-obvious why, never for what the code does.
- **No defensive error handling at internal boundaries.** Trust internal callers; validate only at user/API boundaries.
- **Server actions** for all mutations; `revalidatePath` to refresh.
- **TanStack Query / SWR** not used unless we need it. Server components + revalidate are enough so far.
- **No icon library** — inline SVGs in `components/icons.tsx` matched to the Coinbase reference stroke weight.
- **Currency formatting** through `lib/format.ts`. Don't hand-roll `toLocaleString` per page.
