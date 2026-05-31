import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
};

export function HomeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}

export function PortfolioIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </svg>
  );
}

export function WatchlistIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="m12 4 2.4 5 5.5.8-4 3.9.95 5.5L12 16.6 7.15 19.2 8.1 13.7l-4-3.9 5.5-.8L12 4Z" />
    </svg>
  );
}

export function MarketsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 16 9 10l4 4 7-8" />
      <path d="M16 6h4v4" />
    </svg>
  );
}

export function TransactionsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h10" />
      <path d="M4 17h16" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" />
      <path d="m13.5 8.5.9 2 2.1.4-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L10.5 11l2.1-.4.9-2Z" />
    </svg>
  );
}

export function AlertsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function HelpIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="6" cy="6" r="1.6" />
      <circle cx="12" cy="6" r="1.6" />
      <circle cx="18" cy="6" r="1.6" />
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
      <circle cx="6" cy="18" r="1.6" />
      <circle cx="12" cy="18" r="1.6" />
      <circle cx="18" cy="18" r="1.6" />
    </svg>
  );
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      {...base}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      {...props}
    >
      <path d="m12 4 2.4 5 5.5.8-4 3.9.95 5.5L12 16.6 7.15 19.2 8.1 13.7l-4-3.9 5.5-.8L12 4Z" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2.4} {...props}>
      <path d="M5 15l5-5 4 4 6-7" />
      <path d="M16 11h4V7" />
    </svg>
  );
}

export function ArrowDownRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2.4} {...props}>
      <path d="M5 9l5 5 4-4 6 7" />
      <path d="M16 13h4v4" />
    </svg>
  );
}

export function ArrowSwapIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <path d="M7 4v16M7 20l-3-3M7 4l3 3" />
      <path d="M17 20V4M17 4l3 3M17 20l-3-3" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function BankIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M3 9 12 4l9 5" />
      <path d="M5 9v8M9 9v8M15 9v8M19 9v8" />
      <path d="M3 19h18" />
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M5 4h10l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M14 4v5h5" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="m8.5 10.5 7-4M8.5 13.5l7 4" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6 6 2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
    </svg>
  );
}

export function LogoMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="11" fill="#0a0b0d" />
      <path d="M8 8h3.5a3 3 0 1 1 0 6H8V8Zm0 6h4a3 3 0 1 1 0 6H8v-6Z" fill="#0a0b0d" />
      <rect x="9" y="6" width="1.5" height="14" rx="0.75" fill="#0a0b0d" />
    </svg>
  );
}
