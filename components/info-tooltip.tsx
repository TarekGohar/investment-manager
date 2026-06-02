"use client";

import { useEffect, useId, useRef, useState } from "react";
import { InfoIcon } from "@/components/icons";

/**
 * Small "i" icon that reveals a styled tooltip on hover (desktop) or tap
 * (mobile). Replaces the native `<abbr title>` tooltip so it's themable and
 * touch-friendly. Tooltip body is rendered with `position: fixed` so it
 * escapes overflow-clipping parents (cards, scrollable tables).
 */
export function InfoTooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const visible = open || hover;

  // Recompute position when visible state flips on, plus on scroll/resize.
  useEffect(() => {
    if (!visible) return;
    function place() {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords({ top: r.top, left: r.left + r.width / 2 });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [visible]);

  // ESC + outside click close the persistent (tap-opened) tooltip.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex items-center align-middle">
      <button
        type="button"
        aria-label="More info"
        aria-describedby={visible ? id : undefined}
        aria-expanded={visible}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="ml-1 inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-muted-2 transition-colors hover:text-text focus:outline-none focus-visible:text-text"
      >
        <InfoIcon className="h-full w-full" />
      </button>
      {visible && coords ? (
        <span
          role="tooltip"
          id={id}
          style={{
            position: "fixed",
            top: coords.top - 8,
            left: coords.left,
            transform: "translate(-50%, -100%)",
            maxWidth: "min(260px, calc(100vw - 24px))",
          }}
          className="pointer-events-none z-[100] rounded-[8px] border border-border bg-panel-2 px-3 py-2 text-left text-xs font-normal leading-snug text-soft shadow-lg"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
