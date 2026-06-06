import type { ComponentType, SVGProps } from "react";
import {
  AlertsIcon,
  ChatIcon,
  HomeIcon,
  MarketsIcon,
  PortfolioIcon,
  SettingsIcon,
  TransactionsIcon,
} from "@/components/icons";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  matchPrefixes?: string[];
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Home", href: "/", icon: HomeIcon },
      { label: "Decisions", href: "/decisions", icon: AlertsIcon },
      {
        label: "Portfolio",
        href: "/portfolio",
        icon: PortfolioIcon,
        matchPrefixes: ["/portfolio", "/positions"],
      },
      { label: "Transactions", href: "/transactions", icon: TransactionsIcon },
      { label: "Research", href: "/research", icon: MarketsIcon },
      { label: "Review", href: "/review", icon: PortfolioIcon },
      { label: "Speak to PM", href: "/chat", icon: ChatIcon },
    ],
  },
];

export const NAV: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

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
