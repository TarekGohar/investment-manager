"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export type PositionTabKey =
  | "Overview"
  | "Thesis"
  | "News"
  | "Fundamentals"
  | "Filings"
  | "Transactions"
  | "Tax";

export type PositionTab = {
  key: PositionTabKey;
  content: ReactNode;
};

export function PositionTabs({
  tabs,
  defaultTab,
}: {
  tabs: PositionTab[];
  defaultTab?: PositionTabKey;
}) {
  const initial = defaultTab && tabs.some((t) => t.key === defaultTab) ? defaultTab : tabs[0]?.key;
  const [active, setActive] = useState<PositionTabKey | undefined>(initial);

  if (tabs.length === 0) return null;

  return (
    <>
      <div className="mb-[26px] flex gap-[26px] border-b border-border">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`relative -mb-px pb-[14px] text-[15px] font-semibold transition-colors ${
                isActive ? "text-text" : "text-muted hover:text-text"
              }`}
            >
              {t.key}
              {isActive ? (
                <span className="absolute -bottom-px left-0 right-0 h-[2px] rounded-[2px] bg-brand" />
              ) : null}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div key={t.key} hidden={t.key !== active}>
          {t.content}
        </div>
      ))}
    </>
  );
}
