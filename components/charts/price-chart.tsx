type Bar = {
  ts: number;
  close: number;
};

type PriceChartProps = {
  bars: Bar[];
  /** Sign of the move; controls line + fill colors. */
  direction?: "up" | "down" | "auto";
  height?: number;
  showMidline?: boolean;
  showHiLo?: boolean;
  formatValue?: (v: number) => string;
  /** Stable suffix for SVG ids — use the ticker or chart name to avoid collisions */
  id?: string;
};

const W = 1000;
const PAD_TOP = 30;
const PAD_BOT = 40;

// Adaptive: penny stocks show 4 decimals so $0.075 doesn't render as $0.08.
const defaultFormatter = (v: number) => {
  const abs = Math.abs(v);
  const max = abs === 0 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  });
};

export function PriceChart({
  bars,
  direction = "auto",
  height = 260,
  showMidline = true,
  showHiLo = true,
  formatValue = defaultFormatter,
  id = "chart",
}: PriceChartProps) {
  if (bars.length < 2) {
    return <div className="rounded-card border border-border bg-panel" style={{ height }} />;
  }

  const values = bars.map((b) => b.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const x = (i: number) => (i / (bars.length - 1)) * W;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / range) * (height - PAD_TOP - PAD_BOT);

  const linePath = bars
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(b.close).toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${W} ${height} L0 ${height} Z`;

  const sign = direction === "auto" ? (values.at(-1)! >= values[0] ? "up" : "down") : direction;
  const stroke = sign === "up" ? "var(--color-success)" : "var(--color-danger)";

  const hiIdx = values.indexOf(max);
  const loIdx = values.indexOf(min);

  const midY = y((min + max) / 2);

  const gradId = `chart-fill-${id}`;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="block h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        {showMidline ? (
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
        ) : null}

        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {showHiLo ? (
        <>
          <Annotation
            xPct={(hiIdx / (bars.length - 1)) * 100}
            yPct={(y(max) / height) * 100}
            label={formatValue(max)}
            above
          />
          <Annotation
            xPct={(loIdx / (bars.length - 1)) * 100}
            yPct={(y(min) / height) * 100}
            label={formatValue(min)}
          />
        </>
      ) : null}
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

/**
 * Deterministic mock bar generator — useful for stubbed charts.
 * Same output for the same seed, so SSR + hydration match.
 */
export function mockBars({
  seed = 42,
  count = 160,
  start = 100,
  drift = -0.48,
  amplitude = 3.2,
  waveScale = 9,
}: {
  seed?: number;
  count?: number;
  start?: number;
  drift?: number;
  amplitude?: number;
  waveScale?: number;
} = {}): Bar[] {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const out: Bar[] = [];
  let v = start;
  for (let i = 0; i < count; i++) {
    v += (rnd() + drift) * amplitude + Math.sin(i / waveScale) * 0.5;
    out.push({ ts: Date.now() - (count - i) * 60_000, close: v });
  }
  return out;
}
