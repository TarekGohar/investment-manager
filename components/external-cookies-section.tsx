"use client";

import { useState, useTransition } from "react";
import {
  saveExternalCookieSessionAction,
  deleteExternalCookieSessionAction,
  testSedarCookiesAction,
} from "@/app/actions/external-cookies";
import { useToast } from "@/components/toast-provider";

export type CookieSessionRow = {
  source: string;
  hasCookies: boolean;
  userAgent: string | null;
  notes: string | null;
  updatedAt: Date | null;
};

export function ExternalCookiesSection({
  sedarSession,
}: {
  sedarSession: CookieSessionRow;
}) {
  const toast = useToast();
  const [cookieHeader, setCookieHeader] = useState("");
  const [userAgent, setUserAgent] = useState(
    sedarSession.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  );
  const [notes, setNotes] = useState(sedarSession.notes ?? "");
  const [pending, startTransition] = useTransition();
  const [testing, startTest] = useTransition();
  const [showHowTo, setShowHowTo] = useState(!sedarSession.hasCookies);

  function save() {
    const trimmed = cookieHeader.trim();
    if (!trimmed) {
      toast({ title: "Paste your Cookie header first", variant: "error" });
      return;
    }
    startTransition(async () => {
      const result = await saveExternalCookieSessionAction({
        source: "SEDAR_PLUS",
        cookieHeader: trimmed,
        userAgent: userAgent.trim(),
        notes: notes.trim(),
      });
      if (result.ok) {
        toast({ title: "Cookies saved", variant: "success" });
        setCookieHeader("");
      } else {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  function test() {
    startTest(async () => {
      const result = await testSedarCookiesAction();
      if (result.ok) {
        toast({ title: "SEDAR+ session valid", description: result.detail, variant: "success" });
      } else {
        toast({ title: "Session check failed", description: result.error, variant: "error" });
      }
    });
  }

  function remove() {
    if (!confirm("Delete saved SEDAR+ cookies?")) return;
    startTransition(async () => {
      const r = await deleteExternalCookieSessionAction("SEDAR_PLUS");
      if (r.ok) {
        toast({ title: "Cookies deleted", variant: "success" });
        setShowHowTo(true);
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        SEDAR+ (Canadian securities filings) is fronted by Radware ShieldSquare
        + hCaptcha, so we can&apos;t fetch it directly. The workaround: you
        solve the captcha once in your browser, copy the session cookies, and
        paste them here. Server-side fetches reuse those cookies until they
        expire (typically days to weeks). Refresh by repeating the steps.
      </p>

      <div className="rounded-[10px] bg-bg/40 px-3 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[13px] font-semibold">
            SEDAR+ session{" "}
            <span
              className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                sedarSession.hasCookies ? "bg-success/15 text-success" : "bg-muted/15 text-muted"
              }`}
            >
              {sedarSession.hasCookies ? "Cookies saved" : "Not configured"}
            </span>
          </div>
          {sedarSession.hasCookies ? (
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={test}
                disabled={testing}
                className="text-brand-2 hover:underline disabled:opacity-50"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              <button
                type="button"
                onClick={remove}
                className="text-muted hover:text-danger"
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
        {sedarSession.hasCookies && sedarSession.updatedAt ? (
          <p className="mt-1 text-xs text-muted-2">
            Captured{" "}
            {sedarSession.updatedAt.toLocaleString("en-CA", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {sedarSession.notes ? ` · ${sedarSession.notes}` : ""}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setShowHowTo((v) => !v)}
        className="text-xs text-brand-2 hover:underline"
      >
        {showHowTo ? "Hide" : "Show"} step-by-step how to capture cookies
      </button>

      {showHowTo ? (
        <div className="rounded-[10px] border border-border bg-bg/40 px-3 py-3 text-xs leading-relaxed text-muted">
          <ol className="ml-4 list-decimal space-y-2">
            <li>
              Open a Chrome / Edge / Brave window and go to{" "}
              <span className="font-mono text-text">https://www.sedarplus.ca</span>.
            </li>
            <li>
              Solve the hCaptcha if prompted. You should land on the SEDAR+ home page.
            </li>
            <li>
              Open DevTools (⌘⌥I / Ctrl+Shift+I) → <strong>Network</strong> tab. Reload the page.
            </li>
            <li>
              Click the first request to <span className="font-mono">sedarplus.ca</span> in the
              Network panel. Scroll to the <strong>Request Headers</strong> section.
            </li>
            <li>
              Find the <span className="font-mono">Cookie:</span> header. Click to expand it,
              then copy the entire value (everything after &ldquo;Cookie: &rdquo;).
            </li>
            <li>Paste it into the Cookie header field below.</li>
            <li>
              In the same Request Headers, copy the{" "}
              <span className="font-mono">User-Agent:</span> value and paste it into the
              User-Agent field — the cookies are bound to that exact fingerprint, so it has
              to match.
            </li>
            <li>Click Save, then Test connection.</li>
          </ol>
          <p className="mt-3 text-muted-2">
            Heads-up: if Radware rotates the session, the saved cookies stop working and
            you&apos;ll see &ldquo;Cookies rejected&rdquo;. Repeat the steps to refresh.
          </p>
        </div>
      ) : null}

      <div className="rounded-[10px] bg-bg/40 px-3 py-3 space-y-3">
        <div>
          <label className="block text-[13px] font-semibold">Cookie header</label>
          <p className="mb-1 text-xs text-muted">
            The full value of your browser&apos;s <span className="font-mono">Cookie:</span>{" "}
            header on sedarplus.ca.
          </p>
          <textarea
            value={cookieHeader}
            onChange={(e) => setCookieHeader(e.target.value)}
            placeholder="__uzma=...; __uzmb=...; __uzmc=...; ..."
            rows={3}
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-2 text-xs font-mono"
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold">User-Agent</label>
          <p className="mb-1 text-xs text-muted">
            Must match the browser you captured the cookies from.
          </p>
          <input
            type="text"
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-xs font-mono"
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Captured 2026-05-31 from Chrome"
            className="w-full rounded-[8px] border border-border bg-panel px-2.5 py-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save cookies"}
          </button>
        </div>
      </div>
    </div>
  );
}
