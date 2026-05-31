import { formatCurrency } from "@/lib/format";

const PALETTE = [
  "#3773f5",
  "#27ad75",
  "#f7931a",
  "#9b5cf6",
  "#e8484b",
  "#27c0e8",
];
const OTHER_COLOR = "#5b616e";

type Item = { ticker: string; value: number };
type Slice = { label: string; value: number; pct: number; color: string };

const RING_OUTER = 90;
const RING_INNER = 60;
const CX = 100;
const CY = 100;

function makeSlices(items: Item[]): { slices: Slice[]; total: number } {
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (total === 0) return { slices: [], total: 0 };

  const sorted = [...positive].sort((a, b) => b.value - a.value);

  if (sorted.length <= 6) {
    return {
      slices: sorted.map((i, idx) => ({
        label: i.ticker,
        value: i.value,
        pct: (i.value / total) * 100,
        color: PALETTE[idx % PALETTE.length],
      })),
      total,
    };
  }

  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  const otherSum = rest.reduce((s, i) => s + i.value, 0);

  return {
    slices: [
      ...top.map((i, idx) => ({
        label: i.ticker,
        value: i.value,
        pct: (i.value / total) * 100,
        color: PALETTE[idx],
      })),
      {
        label: `Other (${rest.length})`,
        value: otherSum,
        pct: (otherSum / total) * 100,
        color: OTHER_COLOR,
      },
    ],
    total,
  };
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
): string {
  // Full circle — render as two concentric circles via two arcs each.
  if (endDeg - startDeg >= 360 - 0.01) {
    return [
      `M ${cx - rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy}`,
      `Z`,
      `M ${cx - rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy}`,
      `Z`,
    ].join(" ");
  }

  const s1 = polar(cx, cy, rOuter, startDeg);
  const e1 = polar(cx, cy, rOuter, endDeg);
  const s2 = polar(cx, cy, rInner, endDeg);
  const e2 = polar(cx, cy, rInner, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M ${s1.x} ${s1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${e1.x} ${e1.y}`,
    `L ${s2.x} ${s2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${e2.x} ${e2.y}`,
    `Z`,
  ].join(" ");
}

export function AllocationDonut({
  items,
  title = "Allocation",
  subtitle,
}: {
  items: Item[];
  title?: string;
  subtitle?: string;
}) {
  const { slices, total } = makeSlices(items);

  if (slices.length === 0) {
    return null;
  }

  let angle = 0;
  const paths = slices.map((slice) => {
    const span = (slice.pct / 100) * 360;
    const d = arcPath(CX, CY, RING_OUTER, RING_INNER, angle, angle + span);
    angle += span;
    return { d, color: slice.color };
  });

  return (
    <section className="mb-[26px] rounded-card border border-border bg-panel p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {subtitle ? <span className="text-xs text-muted">{subtitle}</span> : null}
      </div>
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-8">
        <div className="relative shrink-0">
          <svg width={200} height={200} viewBox="0 0 200 200" aria-hidden="true">
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill={p.color}
                fillRule="evenodd"
                stroke="var(--color-bg)"
                strokeWidth={1}
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Total
            </div>
            <div className="text-[17px] font-semibold tabular-nums">
              {formatCurrency(total)}
            </div>
          </div>
        </div>

        <ul className="w-full flex-1 space-y-2">
          {slices.map((slice) => (
            <li
              key={slice.label}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: slice.color }}
                />
                <span className="truncate text-sm font-semibold">{slice.label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm tabular-nums">
                <span>{slice.pct.toFixed(1)}%</span>
                <span className="hidden text-muted sm:inline">
                  {formatCurrency(slice.value)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
