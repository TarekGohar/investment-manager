import { SCORE_LABEL, SCORE_TONE, type LocationScore } from "@/lib/canadian/location";

export function LocationBadge({
  score,
  size = "md",
}: {
  score: LocationScore;
  size?: "sm" | "md";
}) {
  const tone = SCORE_TONE[score];
  const label = SCORE_LABEL[score];
  const sizeClass =
    size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";
  return (
    <span
      className={`inline-block rounded-full font-semibold uppercase tracking-wide ${tone} ${sizeClass}`}
    >
      {label}
    </span>
  );
}
