"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Status = "idle" | "sending" | "sent" | "error";

export function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending" || !email) return;
    setStatus("sending");
    setErrorMsg(null);

    const result = await authClient.signIn.magicLink({
      email,
      callbackURL: next,
    });

    if (result?.error) {
      setStatus("error");
      setErrorMsg(result.error.message ?? "Couldn't send link. Try again.");
      return;
    }

    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="rounded-card border border-border bg-panel p-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </div>
        <h2 className="text-[18px] font-semibold">Check your inbox</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          We sent a sign-in link to <span className="font-medium text-text">{email}</span>. It expires in 10 minutes.
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setEmail("");
          }}
          className="mt-6 text-sm font-semibold text-brand-2 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-card border border-border bg-panel p-8" noValidate>
      <label htmlFor="email" className="mb-2 block text-sm font-medium text-muted">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoFocus
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-[12px] border border-border bg-bg px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-muted-2 focus:border-brand"
      />

      {errorMsg ? <div className="mt-3 text-sm text-danger">{errorMsg}</div> : null}

      <button
        type="submit"
        disabled={status === "sending" || !email}
        className="mt-5 w-full rounded-[28px] bg-gradient-to-r from-brand to-brand-3 py-[15px] text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" ? "Sending link…" : "Send magic link"}
      </button>

      <p className="mt-4 text-center text-xs text-muted">
        We&apos;ll email you a single-use link — no password required.
      </p>
    </form>
  );
}
