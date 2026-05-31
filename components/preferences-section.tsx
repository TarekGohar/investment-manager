"use client";

import { useState, useTransition } from "react";
import { setPreferenceAction } from "@/app/actions/preferences";
import { useToast } from "@/components/toast-provider";
import type { UserPreferences } from "@/lib/preferences";

type ToggleItem = {
  key: keyof UserPreferences;
  title: string;
  description: string;
};

const TOGGLES: ToggleItem[] = [
  {
    key: "aiAutoDailyReview",
    title: "Auto-generate daily PM review",
    description:
      "Run the daily portfolio review at 21:15 UTC on trading days. Disable to skip the AI call and the cost it incurs.",
  },
  {
    key: "aiAutoWeeklyReview",
    title: "Auto-generate weekly PM review",
    description: "Run the weekly deep-dive on Sundays at 13:00 UTC.",
  },
  {
    key: "aiNewsClassification",
    title: "Classify news with AI",
    description:
      "Runs hourly. Tags incoming news as INFO / MATERIAL / CRITICAL so NEWS_MATERIAL alerts can fire. A few cents per month at most.",
  },
  {
    key: "emailDigestEnabled",
    title: "Email alert digests",
    description:
      "Master switch for Mailgun digests. Individual alerts still need the EMAIL channel enabled.",
  },
];

export function PreferencesSection({
  initial,
}: {
  initial: UserPreferences;
}) {
  return (
    <div className="space-y-3">
      {TOGGLES.map((t) => (
        <PreferenceRow key={t.key} item={t} initialValue={initial[t.key]} />
      ))}
    </div>
  );
}

function PreferenceRow({
  item,
  initialValue,
}: {
  item: ToggleItem;
  initialValue: boolean;
}) {
  const toast = useToast();
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    const next = !value;
    setValue(next); // optimistic
    startTransition(async () => {
      const result = await setPreferenceAction(item.key, next);
      if (!result.ok) {
        setValue(!next); // revert
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-[10px] bg-bg/40 px-3 py-3">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{item.title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={toggle}
        disabled={pending}
        className={`mt-1 flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          value ? "bg-brand" : "bg-pill"
        } disabled:opacity-50`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
