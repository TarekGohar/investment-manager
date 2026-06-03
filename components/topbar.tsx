import Link from "next/link";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { AlertsIcon, BackIcon, GridIcon, HelpIcon } from "@/components/icons";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { SearchBar } from "@/components/search-bar";
import { MobileNav } from "@/components/mobile-nav";
import { getThemeFromCookie } from "@/lib/theme";
import { getUserTickers } from "@/lib/portfolio/queries";
import { countUnreadEvents } from "@/lib/signals/queries";
import { getUserPreferences } from "@/lib/preferences";
import { getMonthlyTokenUsage } from "@/lib/ai/queries";

type TopbarProps = {
  title: ReactNode;
  backHref?: string;
  rightSlot?: ReactNode;
};

export async function Topbar({ title, backHref, rightSlot }: TopbarProps) {
  const [session, theme] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    getThemeFromCookie(),
  ]);
  const user = session?.user;
  const [tickers, notifications, preferences, tokenUsage] = user
    ? await Promise.all([
        getUserTickers(user.id),
        countUnreadEvents(user.id),
        getUserPreferences(user.id),
        getMonthlyTokenUsage(user.id),
      ])
    : [[], 0, null, null];
  const showBadge = preferences?.showNotificationBadge !== false;

  return (
    <header className="sticky top-0 z-10 flex h-[calc(72px+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-border bg-bg px-4 pt-[env(safe-area-inset-top)] md:gap-3 md:px-6 lg:gap-[18px] lg:px-[26px]">
      <MobileNav />

      {backHref ? (
        <Link
          href={backHref}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel transition-colors hover:bg-panel-2"
        >
          <BackIcon className="h-5 w-5" />
        </Link>
      ) : null}

      <h1 className="truncate text-[18px] font-semibold leading-none md:text-[20px] lg:text-[22px]">
        {title}
      </h1>

      <div className="flex-1" />

      <div className="hidden sm:block">
        <SearchBar tickers={tickers} />
      </div>

      <Link
        href="/alerts"
        aria-label={
          showBadge && notifications > 0
            ? `Alerts — ${notifications} unread`
            : "Alerts"
        }
        className="relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel text-text transition-colors hover:bg-panel-2 sm:flex"
      >
        {showBadge && notifications > 0 ? (
          <span className="absolute -right-[3px] -top-[3px] flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] border-2 border-bg bg-danger px-[5px] text-[11px] font-bold text-white">
            {notifications > 99 ? "99+" : notifications}
          </span>
        ) : null}
        <AlertsIcon className="h-5 w-5" />
      </Link>

      <ThemeToggle initial={theme} />

      <button
        type="button"
        aria-label="Help"
        className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel text-text transition-colors hover:bg-panel-2 md:flex"
      >
        <HelpIcon className="h-5 w-5" />
      </button>

      <button
        type="button"
        aria-label="Apps"
        className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel text-text transition-colors hover:bg-panel-2 lg:flex"
      >
        <GridIcon className="h-5 w-5" />
      </button>

      {user ? (
        <UserMenu
          name={user.name}
          email={user.email}
          image={user.image}
          tokensThisMonth={tokenUsage?.totalTokens ?? 0}
          costThisMonthUsd={tokenUsage?.costUsd ?? 0}
          costBreakdown={tokenUsage?.byFamily}
        />
      ) : null}

      {rightSlot}
    </header>
  );
}
