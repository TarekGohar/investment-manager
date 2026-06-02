"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark, MenuIcon, XIcon } from "@/components/icons";
import { NAV, SETTINGS_NAV, isNavActive } from "@/components/nav-items";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close drawer after navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-panel text-text transition-colors hover:bg-panel-2 lg:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      {open ? (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-border bg-bg px-4 pb-[calc(22px+env(safe-area-inset-bottom))] pt-[calc(22px+env(safe-area-inset-top))] shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <Link
                href="/"
                aria-label="Home"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white"
                onClick={() => setOpen(false)}
              >
                <LogoMark className="h-5 w-5" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel hover:text-text"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-1 flex-col gap-1">
              {NAV.map((item) => {
                const active = isNavActive(pathname, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-4 rounded-[10px] px-3 py-[11px] text-[15px] font-semibold transition-colors ${
                      active ? "bg-panel text-text" : "text-text hover:bg-panel"
                    }`}
                  >
                    <Icon className="h-[22px] w-[22px] shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <Link
              href={SETTINGS_NAV.href}
              onClick={() => setOpen(false)}
              className={`mt-auto flex items-center gap-4 rounded-[10px] px-3 py-[11px] text-[15px] font-semibold transition-colors ${
                pathname.startsWith(SETTINGS_NAV.href)
                  ? "bg-panel text-text"
                  : "text-text hover:bg-panel"
              }`}
            >
              <SETTINGS_NAV.icon className="h-[22px] w-[22px] shrink-0" />
              {SETTINGS_NAV.label}
            </Link>
          </aside>
        </div>
      ) : null}
    </>
  );
}
