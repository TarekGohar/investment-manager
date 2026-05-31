"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RangePills, type Range } from "@/components/range-pills";
import { ArrowDownRightIcon, ArrowUpRightIcon, ChatIcon } from "@/components/icons";
import { WatchlistStar } from "@/components/watchlist-star";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";
import type { Quote } from "@/lib/marketdata";

type Bar = { ts: number; close: number };

const W = 1000;
const H = 260;
const PAD_TOP = 30;
const PAD_BOT = 40;

const DAY_CUTOFFS = {
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  All: 99999,
} as const;

const RANGE_LABEL: Record<Range, string> = {
  "1D": "today",
  "1W": "this week",
  "1M": "this month",
  "3M": "3 months",
  "1Y": "this year",
  All: "all-time",
};

export function PositionChart({
  ticker,
  baseQuote,
  daily,
  intraday1D,
  intraday1W,
  initialRange = "1M",
  watched = false,
}: {
  ticker: string;
  baseQuote: Quote | null;
  daily: Bar[];
  intraday1D: Bar[];
  intraday1W: Bar[];
  initialRange?: Range;
  watched?: boolean;
}) {
  const [range, setRange] = useState<Range>(initialRange);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const enabled = useMemo<Range[]>(() => {
    const r: Range[] = [];
    if (intraday1D.length >= 2) r.push("1D");
    if (intraday1W.length >= 2) r.push("1W");
    if (daily.length >= 2) {
      const now = Date.now();
      const oldest = daily[0].ts;
      if (now - oldest >= 30 * 86_400_000) r.push("1M");
      if (now - oldest >= 90 * 86_400_000) r.push("3M");
      if (now - oldest >= 365 * 86_400_000) r.push("1Y");
      r.push("All");
    }
    return r;
  }, [daily, intraday1D, intraday1W]);

  const bars = useMemo<Bar[]>(() => {
    if (range === "1D") return intraday1D;
    if (range === "1W") return intraday1W;
    const cutoff = Date.now() - DAY_CUTOFFS[range as keyof typeof DAY_CUTOFFS] * 86_400_000;
    return daily.filter((b) => b.ts >= cutoff);
  }, [range, daily, intraday1D, intraday1W]);

  // Clamp the hover index against the currently visible bars (in case range shrank)
  const validHoverIdx =
    hoveredIdx != null && hoveredIdx < bars.length && hoveredIdx >= 0 ? hoveredIdx : null;
  const hoveredBar = validHoverIdx != null ? bars[validHoverIdx] : null;

  const first = bars[0]?.close ?? 0;
  const last = bars[bars.length - 1]?.close ?? 0;

  // Display values — hovered point wins; otherwise show base quote (for 1D) or
  // the net move across the visible window.
  const displayPrice = hoveredBar?.close ?? baseQuote?.price ?? last;

  const displayChange = hoveredBar
    ? hoveredBar.close - first
    : range === "1D" && baseQuote
      ? baseQuote.change
      : last - first;

  const displayChangePct = hoveredBar
    ? first > 0
      ? ((hoveredBar.close - first) / first) * 100
      : 0
    : range === "1D" && baseQuote
      ? baseQuote.changePct
      : first > 0
        ? ((last - first) / first) * 100
        : 0;

  const subLabel = hoveredBar
    ? formatHoverDate(hoveredBar.ts, range)
    : RANGE_LABEL[range];

  // Net direction of visible range (drives chart color)
  const lineDir: "up" | "down" = last >= first ? "up" : "down";
  // Sign of the displayed change (drives hero color)
  const heroUp = displayChange >= 0;

  const action = (
    <div className="flex items-center gap-2">
      <Link
        href={`/chat?ticker=${ticker}`}
        aria-label={`Ask the PM about ${ticker}`}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-brand-2 transition-colors hover:bg-panel-2"
      >
        <ChatIcon className="h-5 w-5" />
      </Link>
      <WatchlistStar ticker={ticker} initiallyWatched={watched} />
    </div>
  );

  if (daily.length < 2 && intraday1D.length < 2 && intraday1W.length < 2) {
    return (
      <Hero
        price={baseQuote?.price ?? 0}
        change={baseQuote?.change ?? 0}
        changePct={baseQuote?.changePct ?? 0}
        subLabel="today"
        up={(baseQuote?.changePct ?? 0) >= 0}
        actionSlot={action}
      >
        <div className="my-6 rounded-card border border-dashed border-border bg-panel/40 p-8 text-center text-sm text-muted">
          Historical price data isn&apos;t available for this ticker.
        </div>
      </Hero>
    );
  }

  if (bars.length < 2) {
    return (
      <Hero
        price={displayPrice}
        change={displayChange}
        changePct={displayChangePct}
        subLabel={RANGE_LABEL[range]}
        up={heroUp}
        actionSlot={action}
      >
        <div className="flex h-[260px] items-center justify-center rounded-card border border-dashed border-border bg-panel/40 text-sm text-muted">
          No data for this range yet.
        </div>
        <div className="my-[14px] mb-[22px]">
          <RangePills value={range} onChange={setRange} enabled={enabled} />
        </div>
      </Hero>
    );
  }

  // ─── Chart geometry ─────────────────────────────────────────────────
  const values = bars.map((b) => b.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) => (i / (bars.length - 1)) * W;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOT);

  const linePath = bars
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(b.close).toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${W} ${H} L0 ${H} Z`;
  const midY = y((min + max) / 2);

  const stroke = lineDir === "up" ? "var(--color-success)" : "var(--color-danger)";
  const gradId = `grad-${ticker}-${range}`;

  const hiIdx = values.indexOf(max);
  const loIdx = values.indexOf(min);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoveredIdx(Math.round(ratio * (bars.length - 1)));
  }

  function handleMouseLeave() {
    setHoveredIdx(null);
  }

  return (
    <Hero
      price={displayPrice}
      change={displayChange}
      changePct={displayChangePct}
      subLabel={subLabel}
      up={heroUp}
      actionSlot={action}
    >
      {/* Chart */}
      <div
        className="relative cursor-crosshair select-none"
        style={{ height: H }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>

          <line
            x1={0}
            y1={midY}
            x2={W}
            y2={midY}
            stroke="var(--color-grid)"
            strokeWidth={1}
            strokeDasharray="2 5"
            vectorEffect="non-scaling-stroke"
          />

          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {validHoverIdx != null ? (
            <line
              x1={x(validHoverIdx)}
              y1={0}
              x2={x(validHoverIdx)}
              y2={H - PAD_BOT}
              stroke="rgba(255,255,255,0.22)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
        </svg>

        {/* Hi/Lo (hidden while hovering, for clarity) */}
        {validHoverIdx == null && range !== "1D" ? (
          <>
            <Annotation
              xPct={(hiIdx / (bars.length - 1)) * 100}
              yPct={(y(max) / H) * 100}
              label={formatCurrency(max)}
              above
            />
            <Annotation
              xPct={(loIdx / (bars.length - 1)) * 100}
              yPct={(y(min) / H) * 100}
              label={formatCurrency(min)}
            />
          </>
        ) : null}

        {/* Hover dot (HTML so it doesn't distort under preserveAspectRatio=none) */}
        {validHoverIdx != null ? (
          <div
            className={`pointer-events-none absolute h-3 w-3 rounded-full bg-bg ring-2 ${
              lineDir === "up" ? "ring-success" : "ring-danger"
            }`}
            style={{
              left: `${(validHoverIdx / (bars.length - 1)) * 100}%`,
              top: `${(y(bars[validHoverIdx].close) / H) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
        ) : null}

        {/* Hover date — pinned to the chart bottom, x follows cursor */}
        {validHoverIdx != null ? (
          <div
            className="pointer-events-none absolute whitespace-nowrap rounded-full bg-pill px-2.5 py-1 text-xs font-medium text-muted"
            style={{
              left: `${(validHoverIdx / (bars.length - 1)) * 100}%`,
              bottom: 2,
              transform: "translateX(-50%)",
            }}
          >
            {formatHoverDate(bars[validHoverIdx].ts, range)}
          </div>
        ) : null}
      </div>

      {/* Range pills */}
      <div className="my-[14px] mb-[22px]">
        <RangePills value={range} onChange={setRange} enabled={enabled} />
      </div>
    </Hero>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function Hero({
  price,
  change,
  changePct,
  subLabel,
  up,
  actionSlot,
  children,
}: {
  price: number;
  change: number;
  changePct: number;
  subLabel: string;
  up: boolean;
  actionSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-[18px] flex items-start justify-between">
        <div>
          <div className="text-[32px] font-semibold leading-none tracking-[-0.5px] tabular-nums md:text-[42px]">
            {formatCurrency(price)}
          </div>
          <div
            className={`mt-[10px] flex items-center gap-[6px] text-[16px] font-semibold ${
              up ? "text-success" : "text-danger"
            }`}
          >
            {up ? (
              <ArrowUpRightIcon className="h-4 w-4" />
            ) : (
              <ArrowDownRightIcon className="h-4 w-4" />
            )}
            {formatSignedCurrency(change)} ({formatPercent(changePct)})
            <span className="ml-1 text-[13px] font-medium text-muted">{subLabel}</span>
          </div>
        </div>
        {actionSlot}
      </div>
      {children}
    </div>
  );
}

function Annotation({
  xPct,
  yPct,
  label,
  above = false,
}: {
  xPct: number;
  yPct: number;
  label: string;
  above?: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute text-xs font-medium text-muted"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `translate(-50%, ${above ? "-130%" : "20%"})`,
      }}
    >
      {label}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatHoverDate(ts: number, range: Range): string {
  const d = new Date(ts);
  if (range === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (range === "1W") {
    return d.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (range === "1M" || range === "3M") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
