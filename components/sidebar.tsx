"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/icons";
import { NAV_SECTIONS, SETTINGS_NAV, isNavActive } from "@/components/nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-bg px-4 py-[22px] lg:flex">
      <Link
        href="/"
        aria-label="Home"
        className="mx-[6px] mb-[30px] flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white"
      >
        <LogoMark className="h-5 w-5" />
      </Link>

      <nav className="flex flex-1 flex-col gap-[18px]">
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.label ?? `s${i}`} className="flex flex-col gap-1">
            {section.label ? (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-2">
                {section.label}
              </div>
            ) : null}
            {section.items.map((item) => {
              const active = isNavActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-4 rounded-[10px] px-3 py-[11px] text-[15px] font-semibold transition-colors ${
                    active ? "bg-panel text-text" : "text-text hover:bg-panel"
                  }`}
                >
                  <Icon className="h-[22px] w-[22px] shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto">
        <Link
          href={SETTINGS_NAV.href}
          className={`flex items-center gap-4 rounded-[10px] px-3 py-[11px] text-[15px] font-semibold transition-colors ${
            pathname.startsWith(SETTINGS_NAV.href)
              ? "bg-panel text-text"
              : "text-text hover:bg-panel"
          }`}
        >
          <SETTINGS_NAV.icon className="h-[22px] w-[22px] shrink-0" />
          {SETTINGS_NAV.label}
        </Link>
      </div>
    </aside>
  );
}
