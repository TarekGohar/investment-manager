"use client";

import { useState, useTransition } from "react";
import { toggleWatchlist } from "@/app/actions/watchlist";
import { StarIcon } from "@/components/icons";
import { useToast } from "@/components/toast-provider";

export function WatchlistStar({
  ticker,
  initiallyWatched,
}: {
  ticker: string;
  initiallyWatched: boolean;
}) {
  const toast = useToast();
  const [watched, setWatched] = useState(initiallyWatched);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    const next = !watched;
    setWatched(next); // optimistic
    startTransition(async () => {
      const result = await toggleWatchlist(ticker);
      setWatched(result.watched);
      toast({
        title: result.watched ? `${ticker} added to watchlist` : `${ticker} removed from watchlist`,
        variant: "info",
        durationMs: 2500,
      });
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={watched}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
        watched
          ? "bg-warning/15 text-warning hover:bg-warning/25"
          : "bg-panel text-brand-2 hover:bg-panel-2"
      }`}
    >
      <StarIcon className="h-5 w-5" filled={watched} />
    </button>
  );
}
