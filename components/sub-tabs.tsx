"use client";

import { useState } from "react";

export function SubTabs({
  tabs,
  defaultValue,
  onChange,
}: {
  tabs: readonly string[];
  defaultValue?: string;
  onChange?: (t: string) => void;
}) {
  const [active, setActive] = useState(defaultValue ?? tabs[0]);
  return (
    <div className="mb-[26px] flex gap-[26px] border-b border-border">
      {tabs.map((t) => {
        const isActive = t === active;
        return (
          <button
            key={t}
            type="button"
            onClick={() => {
              setActive(t);
              onChange?.(t);
            }}
            className={`relative -mb-px pb-[14px] text-[15px] font-semibold transition-colors ${
              isActive ? "text-text" : "text-muted hover:text-text"
            }`}
          >
            {t}
            {isActive ? (
              <span className="absolute -bottom-px left-0 right-0 h-[2px] rounded-[2px] bg-brand" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
