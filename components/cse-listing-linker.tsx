"use client";

import { useState, useTransition } from "react";
import { resolveAndSaveCseListingAction } from "@/app/actions/ticker-listing";
import { useToast } from "@/components/toast-provider";

/**
 * Inline form on the Filings tab for `.CN` tickers without a saved CSE
 * listing. User pastes the thecse.com listing URL; we resolve the issuer
 * ID via the page's embedded data and cache the mapping. After that,
 * filings start working automatically.
 */
export function CseListingLinker({ ticker }: { ticker: string }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = url.trim();
    if (!trimmed) {
      toast({ title: "Paste a CSE listing URL", variant: "error" });
      return;
    }
    if (!trimmed.includes("thecse.com")) {
      toast({
        title: "Need a thecse.com listing URL",
        description: "Find the company on thecse.com and copy that page's URL.",
        variant: "error",
      });
      return;
    }
    startTransition(async () => {
      const result = await resolveAndSaveCseListingAction({ ticker, url: trimmed });
      if (result.ok) {
        toast({ title: "Linked", description: "CSE filings are now available.", variant: "success" });
        setUrl("");
      } else {
        toast({ title: "Couldn't link", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <section className="rounded-card border border-warning/30 bg-warning/5 px-6 py-5">
      <h3 className="mb-1 text-[15px] font-semibold">Link this ticker to its CSE listing</h3>
      <p className="mb-3 text-xs text-muted leading-relaxed">
        <span className="font-mono">{ticker}</span> looks like a CSE-listed
        ticker. To pull filings (Material Change Reports, MD&A, annual
        financials, news releases), paste the thecse.com listing page URL
        here once. We&apos;ll extract the issuer ID and cache it. Example:
        <br />
        <span className="font-mono text-text">
          https://thecse.com/en/listings/life-sciences/mountain-valley-md-holdings-inc
        </span>
      </p>
      <div className="flex flex-col gap-2 md:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://thecse.com/en/listings/..."
          className="flex-1 rounded-[8px] border border-border bg-panel px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-[8px] bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Linking…" : "Link listing"}
        </button>
      </div>
    </section>
  );
}
