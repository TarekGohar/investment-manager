# Setup

This is the personal investment manager — Next.js 16, Prisma 7, Supabase Postgres, OpenAI (or Azure OpenAI), Finnhub, optional Mailgun. Single-user by design.

If you only want to run it locally against your own data, follow **Quick start**. If you're deploying to Vercel, read the **Production** section too.

---

## Prerequisites

- **Node 20+** (Node 22 recommended). `node -v` to check.
- **A Postgres database** — Supabase (recommended; this repo's defaults assume it), Neon, or local Postgres.
- **A Finnhub API key** — free at [finnhub.io](https://finnhub.io). Covers quotes, news, fundamentals.
- **An OpenAI or Azure OpenAI key** — for the AI portfolio manager.
- **(Optional) Mailgun** — only needed if you want real magic-link emails and alert-digest emails. Without it, everything still works but emails print to the dev server console.

---

## Quick start

```bash
git clone <repo>
cd investment-manager
npm install
cp .env.example .env.local
# Fill in .env.local — see "Environment variables" below
npx prisma migrate dev      # apply schema, generate client
npm run dev
```

Open `http://localhost:3000`, enter your email, and check your terminal (the one running `npm run dev`) for the sign-in link. Click it → you're in.

---

## Environment variables

All variables live in `.env.local` (gitignored). The minimum you need to boot the app:

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled Postgres connection string (Supabase Supavisor, port 6543) used at runtime |
| `DIRECT_URL` | Yes | Direct/session Postgres connection (port 5432 — Supavisor session mode is fine) for `prisma migrate` |
| `BETTER_AUTH_SECRET` | Yes | Random 32-byte string. Generate with `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Yes | The public URL of your app. `http://localhost:3000` locally; your Vercel URL in prod |
| `AI_PROVIDER` | Yes | `"openai"` (default), `"azure-openai"`, or `"anthropic"` (adapter is a stub — see `lib/ai/providers/anthropic.ts` to finish wiring it) |
| `AI_MODEL` | No | Override the default model. On Azure this is the deployment name, not the model id |
| `OPENAI_API_KEY` | If `AI_PROVIDER=openai` | OpenAI cloud key |
| `AZURE_OPENAI_ENDPOINT` | If `AI_PROVIDER=azure-openai` | e.g. `https://your-resource.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | If `AI_PROVIDER=azure-openai` | Azure key |
| `AZURE_OPENAI_DEPLOYMENT` | If `AI_PROVIDER=azure-openai` | Deployment name (used as `AI_MODEL` fallback) |
| `AZURE_OPENAI_API_VERSION` | No | Defaults to `2024-10-21` |
| `FINNHUB_API_KEY` | Yes (for prices) | Without it, everything reads cached or empty data |
| `ALPHAVANTAGE_API_KEY` | No | Enables earnings-call transcripts in the AI chat (`get_earnings_call_transcript`). Free key at [alphavantage.co](https://www.alphavantage.co/support/#api-key); US companies only. Without it, the transcript tool returns "unavailable" |
| `CRON_SECRET` | For cron in prod | Random 64-hex string. Generate with `openssl rand -hex 32`. Vercel Cron sends this as `Authorization: Bearer <secret>` |
| `MAILGUN_API_KEY` | No | Optional — without it, magic-link + alert emails print to console |
| `MAILGUN_DOMAIN` | No | e.g. `mg.yourdomain.com` |
| `MAILGUN_FROM` | No | Defaults to `Portfolio <noreply@MAILGUN_DOMAIN>` |
| `ANTHROPIC_API_KEY` | If `AI_PROVIDER=anthropic` | Only after you fill in the adapter |

---

## Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com). The free tier is fine — for personal use you'll easily stay within limits.
2. **Database → Connection string**:
   - Copy the **Transaction pooler** URL (port 6543) → `DATABASE_URL`. Add `?pgbouncer=true&connection_limit=1` to the end.
   - Copy the **Session pooler** URL (port 5432) → `DIRECT_URL`. Migrations need DDL support, which the transaction pooler doesn't give us.
3. From the repo root: `npx prisma migrate dev` — applies every migration and generates the Prisma client.

If you'd rather use Neon, plain Postgres, or anything else compatible:
- Set both `DATABASE_URL` and `DIRECT_URL` to URLs that work for runtime and migrations respectively (often the same URL).
- The schema is provider-agnostic — `provider = "postgresql"` in `prisma/schema.prisma`.

---

## AI provider

The interface is in `lib/ai/types.ts`. Three providers can plug into it:

### OpenAI cloud (default)
```
AI_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
# Optional override; default is gpt-4o-mini
# AI_MODEL="gpt-4o"
```

### Azure OpenAI
```
AI_PROVIDER="azure-openai"
AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com"
AZURE_OPENAI_API_KEY="..."
AZURE_OPENAI_DEPLOYMENT="your-deployment-name"
# Optional:
# AZURE_OPENAI_API_VERSION="2024-10-21"
# AI_MODEL="your-deployment-name"  # falls back to AZURE_OPENAI_DEPLOYMENT
```

On Azure the `model` parameter sent to the chat completions API is the **deployment name**, not the underlying model id. The code already handles this.

### Anthropic Claude (placeholder)
`lib/ai/providers/anthropic.ts` is a stub with comments showing exactly what to fill in. When you're ready:
1. `npm install @anthropic-ai/sdk`
2. Replace the stub's body with a real implementation against the existing `AiProvider` interface (use `messages.stream` and map content blocks back to the same `StreamEvent` shape).
3. `AI_PROVIDER="anthropic"`, `ANTHROPIC_API_KEY="sk-ant-..."`, `AI_MODEL="claude-haiku-4-5-20251001"` (or whichever model).

---

## Market data (Finnhub + Yahoo Finance)

- **Finnhub** handles live quotes, company news, and fundamentals. Sign up at [finnhub.io](https://finnhub.io), grab the API key, drop it in `FINNHUB_API_KEY`. Free tier gives 60 calls/min — plenty for a personal app.
- **Yahoo Finance** handles historical candles (Finnhub gates this behind a paid plan). No key required; this uses the community `yahoo-finance2` package and works out of the box.

---

## Email (optional — Mailgun)

Mailgun is used for two things:
1. **Magic-link sign-in emails** — without it, the link prints to the dev server console.
2. **Alert digest emails** — only sent for alerts that have the `EMAIL` channel enabled.

To enable:
1. Create a sending domain in Mailgun (or use the sandbox domain for testing).
2. Add the DNS records Mailgun shows you.
3. Set:
   ```
   MAILGUN_API_KEY="key-..."
   MAILGUN_DOMAIN="mg.yourdomain.com"
   MAILGUN_FROM="Portfolio <noreply@mg.yourdomain.com>"
   ```
4. In `/settings` → **Email** → click "Send test email" to verify.

If `MAILGUN_API_KEY` is unset, every email sender silently falls back to a console log so the app still works.

---

## Cron jobs (Vercel)

`vercel.json` declares the schedules. Routes live under `app/api/cron/*` and are protected by `CRON_SECRET`.

| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/refresh-quotes` | `*/30 * * * *` | Warms the quote cache for all user holdings + watchlist + ticker-scoped alerts |
| `/api/cron/classify-news` | `15 * * * *` | AI-classifies fresh news headlines as INFO / MATERIAL / CRITICAL (so `NEWS_MATERIAL` alerts can fire). Respects the per-user `aiNewsClassification` toggle. |
| `/api/cron/run-alerts` | `2,32 * * * *` | Evaluates every enabled alert; persists fired events; sends Mailgun digest for EMAIL-channel alerts (gated by the per-user `emailDigestEnabled` toggle) |
| `/api/cron/daily-review` | `15 21 * * 1-5` | After US market close, generates the daily portfolio review and saves it to `AIAnalysis`. Dashboard renders the latest. Respects `aiAutoDailyReview`. |
| `/api/cron/weekly-review` | `0 13 * * 0` | Sunday morning — generates the weekly deep-dive. Respects `aiAutoWeeklyReview`. |

Vercel Cron runs every job automatically once you deploy. For local dev, none of these run on a schedule — use the in-app manual triggers:
- **`/alerts` → "Run now"** — evaluates alerts immediately
- **Dashboard PM's read card → "Regenerate"** — generates a fresh daily review
- **Settings → Preferences** — toggle AI background jobs on/off per user

`CRON_SECRET`: generate with `openssl rand -hex 32` and set on Vercel as a project environment variable.

---

## Production (Vercel)

1. Push the repo to GitHub (or your provider of choice).
2. Import to Vercel.
3. Set all environment variables in **Project Settings → Environment Variables**. Mirror your `.env.local`.
4. Vercel auto-detects Next.js — no build config needed.
5. Make sure your `NEXT_PUBLIC_APP_URL` matches the production URL (e.g. `https://your-app.vercel.app`).
6. Cron jobs auto-pick up from `vercel.json` once deployed. Verify at **Project → Cron Jobs**.

`postinstall` runs `prisma generate` so the client is always fresh.

---

## Local dev workflow

```bash
npm run dev          # next dev
npm run db:migrate   # prisma migrate dev (apply new migrations)
npm run db:push      # prisma db push (prototype, skips migration file)
npm run db:studio    # prisma studio — DB GUI
npm run db:generate  # prisma generate (rare; postinstall covers most cases)
npm run lint
```

### Common gotchas

- **`Cannot read properties of undefined (reading 'findUnique')` after a schema change.** The dev server caches the old Prisma client on `globalThis`. Stop the dev server and `npm run dev` again — hot-reload doesn't re-instantiate the singleton.
- **`Bearer <secret>` 401 from cron in dev.** That's expected — cron routes require `Authorization: Bearer ${CRON_SECRET}`. Hit them manually with `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/...` or just use the in-app manual triggers.
- **Magic link doesn't arrive.** Without Mailgun configured, the link prints to the terminal where `npm run dev` is running. Look there. Or set up Mailgun.
- **Direct DB connection fails on Supabase.** Free Supabase projects don't expose `db.<ref>.supabase.co:5432` directly (IPv6 only). Use the **Session pooler** URL (`aws-X-<region>.pooler.supabase.com:5432`) as `DIRECT_URL` instead — already the recommended pattern in this repo.

---

## Architecture map

See `docs/PLAN.md` for the full module breakdown. Top-level shape:

```
app/
  (auth)/sign-in            magic link
  (app)/
    layout.tsx              gated; ToastProvider + Sidebar
    page.tsx                Dashboard (with PM's read card)
    portfolio/              all holdings
    watchlist/              starred tickers
    markets/                indices + sector exposure + top movers
    transactions/           ledger + form
    chat/                   AI conversations (portfolio + per-ticker)
    alerts/                 rules + event feed
    settings/               account, brokerages, AI, email, cron, data sources
    positions/[ticker]/     the showpiece — chart + tabs + tx form
  api/
    auth/[...all]/
    ai/chat/                SSE stream
    cron/                   refresh-quotes · run-alerts · daily-review · weekly-review
lib/
  prisma.ts                 singleton via @prisma/adapter-pg
  auth.ts                   Better Auth + magic link
  mailgun.ts                magic-link + alert digest + test, with console fallback
  ai/                       provider-neutral interface, OpenAI/Azure/Anthropic adapters,
                            persona, tools, conversation queries, reviews
  marketdata/               Finnhub + Yahoo, TTL-aware DB cache
  portfolio/                FIFO holdings derivation + enriched portfolio
  signals/                  alert rules, evaluator with cooldown, queries
  theme.ts                  cookie-driven light/dark
prisma/
  schema.prisma             all models
  migrations/
```