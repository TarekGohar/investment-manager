"use client";

import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/actions/theme";
import { MoonIcon, SunIcon } from "@/components/icons";
import type { Theme } from "@/lib/theme";

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [, startTransition] = useTransition();

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    // Flip the document immediately for instant visual change
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    // Persist for next page load
    startTransition(() => {
      setThemeAction(next);
    });
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-panel text-text transition-colors hover:bg-panel-2"
    >
      {isDark ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
    </button>
  );
}
