"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import { TickerBadge } from "@/components/ticker-badge";
import type { UserTicker } from "@/lib/portfolio/queries";

const TICKER_REGEX = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function SearchBar({ tickers }: { tickers: UserTicker[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const trimmed = query.trim().toUpperCase();
  const matches = trimmed
    ? tickers.filter((t) => t.ticker.includes(trimmed)).slice(0, 8)
    : [];
  const exactInList = matches.some((t) => t.ticker === trimmed);
  const showLookup = !!trimmed && !exactInList && TICKER_REGEX.test(trimmed);
  const totalRows = matches.length + (showLookup ? 1 : 0);

  function go(ticker: string) {
    router.push(`/positions/${ticker}`);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!totalRows) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % totalRows);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + totalRows) % totalRows);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight < matches.length) go(matches[highlight].ticker);
      else if (showLookup) go(trimmed);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setOpen(true);
    setHighlight(0);
  }

  return (
    <div className="relative" ref={containerRef}>
      <label className="flex h-11 w-[180px] items-center gap-[10px] rounded-[24px] bg-panel px-[18px] text-muted md:w-[260px] lg:w-[380px]">
        <SearchIcon className="h-5 w-5 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search your positions…"
          value={query}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent text-[15px] rounded-none! text-text placeholder:text-muted outline-none ring-0 focus:outline-none focus:ring-0 active:outline-none active:ring-0"
          style={{ outline: "none", boxShadow: "none" }}
        />
      </label>

      {open && totalRows > 0 ? (
        <div className="absolute left-0 right-0 top-12 z-30 max-h-[360px] overflow-y-auto rounded-card border border-border bg-panel p-2 shadow-2xl">
          {matches.map((t, i) => {
            const active = i === highlight;
            return (
              <button
                key={t.ticker}
                type="button"
                onClick={() => go(t.ticker)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-panel-2" : "hover:bg-panel-2"
                }`}>
                <TickerBadge ticker={t.ticker} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {t.ticker}
                  </div>
                </div>
                <div className="text-xs text-muted">
                  {t.source === "holding" ? "Position" : "Watchlist"}
                </div>
              </button>
            );
          })}
          {showLookup ? (
            <button
              type="button"
              onClick={() => go(trimmed)}
              onMouseEnter={() => setHighlight(matches.length)}
              className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                highlight === matches.length ? "bg-panel-2" : "hover:bg-panel-2"
              }`}>
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-pill text-muted">
                <SearchIcon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 text-[14px] font-medium text-soft">
                Look up{" "}
                <span className="font-semibold text-text">{trimmed}</span>
              </div>
              <div className="text-xs text-muted-2">↵</div>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
