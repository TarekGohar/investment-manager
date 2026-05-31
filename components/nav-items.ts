import type { ComponentType, SVGProps } from "react";
import {
  AlertsIcon,
  ChatIcon,
  HomeIcon,
  MarketsIcon,
  PortfolioIcon,
  SettingsIcon,
  TransactionsIcon,
  WatchlistIcon,
} from "@/components/icons";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  matchPrefixes?: string[];
};

export const NAV: NavItem[] = [
  { label: "Home", href: "/", icon: HomeIcon },
  {
    label: "Portfolio",
    href: "/portfolio",
    icon: PortfolioIcon,
    matchPrefixes: ["/portfolio", "/positions"],
  },
  { label: "Watchlist", href: "/watchlist", icon: WatchlistIcon },
  { label: "Markets", href: "/markets", icon: MarketsIcon },
  { label: "Transactions", href: "/transactions", icon: TransactionsIcon },
  { label: "AI Chat", href: "/chat", icon: ChatIcon },
  { label: "Alerts", href: "/alerts", icon: AlertsIcon },
];

export const SETTINGS_NAV: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: SettingsIcon,
};

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefixes) {
    return item.matchPrefixes.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
  }
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
