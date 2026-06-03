"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type UserMenuProps = {
  name?: string | null;
  email: string;
  image?: string | null;
  /** Claude input + output tokens this app has spent for the user this month. */
  tokensThisMonth?: number;
};

export function UserMenu({ name, email, image, tokensThisMonth }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (name ?? email).charAt(0).toUpperCase();

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.push("/sign-in");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#27c0e8] text-base font-bold text-[#06222b] transition-[filter] hover:brightness-110"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={name ?? email} className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-30 w-64 overflow-hidden rounded-card border border-border bg-panel p-2 shadow-2xl"
        >
          <div className="border-b border-border px-3 py-3">
            <div className="truncate text-sm font-semibold">{name ?? "Signed in"}</div>
            <div className="truncate text-xs text-muted">{email}</div>
          </div>
          {typeof tokensThisMonth === "number" ? (
            <div className="mt-1 rounded-[10px] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-text">Anthropic tokens</span>
                <span className="text-sm tabular-nums text-text">
                  {tokensThisMonth.toLocaleString()}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted">used this month</div>
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm font-medium text-text transition-colors hover:bg-panel-2 disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
