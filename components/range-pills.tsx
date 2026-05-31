"use client";

import { useState } from "react";

export const RANGES = ["1D", "1W", "1M", "3M", "1Y", "All"] as const;
export type Range = (typeof RANGES)[number];

type RangePillsProps = {
  /** Uncontrolled initial value. Ignored if `value` is provided. */
  defaultValue?: Range;
  /** Controlled value — pair with `onChange`. */
  value?: Range;
  onChange?: (r: Range) => void;
  /** Limit which ranges are clickable. Others are visually disabled. */
  enabled?: Range[];
};

export function RangePills({ defaultValue = "1M", value, onChange, enabled }: RangePillsProps) {
  const [internal, setInternal] = useState<Range>(defaultValue);
  const active = value ?? internal;

  const isEnabled = (r: Range) => !enabled || enabled.includes(r);

  function set(r: Range) {
    if (!isEnabled(r)) return;
    if (value === undefined) setInternal(r);
    onChange?.(r);
  }

  return (
    <div className="flex gap-[6px]">
      {RANGES.map((r) => {
        const isActive = r === active;
        const enabled = isEnabled(r);
        return (
          <button
            key={r}
            type="button"
            onClick={() => set(r)}
            disabled={!enabled}
            className={`rounded-[20px] px-4 py-2 text-[13px] font-semibold transition-colors ${
              isActive
                ? "bg-panel text-text"
                : enabled
                  ? "text-muted hover:bg-panel"
                  : "cursor-not-allowed text-muted-2"
            }`}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}
