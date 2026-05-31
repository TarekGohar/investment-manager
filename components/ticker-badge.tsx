const PALETTE = ["#3773f5", "#27ad75", "#f7931a", "#9b5cf6", "#e8484b", "#27c0e8", "#578bfa"];

function colorFor(ticker: string) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) hash = (hash * 31 + ticker.charCodeAt(i)) % 1000;
  return PALETTE[hash % PALETTE.length];
}

export function TickerBadge({ ticker, size = 36 }: { ticker: string; size?: number }) {
  const initials = ticker.replace(/\W/g, "").slice(0, 2);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{
        background: colorFor(ticker),
        width: size,
        height: size,
        fontSize: Math.max(10, size / 3.3),
        fontWeight: 700,
      }}
    >
      {initials}
    </div>
  );
}
