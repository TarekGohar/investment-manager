"use client";

import { useState, useTransition } from "react";
import { setPreferenceAction } from "@/app/actions/preferences";
import { useToast } from "@/components/toast-provider";
import { BOOLEAN_PREFERENCE_KEYS, type UserPreferences } from "@/lib/preferences";

type BooleanPreferenceKey = (typeof BOOLEAN_PREFERENCE_KEYS)[number];

type ToggleItem = {
  key: BooleanPreferenceKey;
  title: string;
  description: string;
};

type Group = {
  label: string;
  items: ToggleItem[];
};

const GROUPS: Group[] = [
  {
    label: "AI background jobs",
    items: [
      {
        key: "aiAutoDailyReview",
        title: "Auto-generate daily PM review",
        description:
          "Run the daily portfolio review at 21:15 UTC on trading days. Skips the AI call (and cost) when off.",
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
          "Hourly cron tags incoming news as INFO / MATERIAL / CRITICAL so NEWS_MATERIAL alerts can fire.",
      },
    ],
  },
  {
    label: "Notifications",
    items: [
      {
        key: "emailDigestEnabled",
        title: "Email alert digests",
        description:
          "Master switch for Mailgun digests. Each alert also needs the EMAIL channel enabled.",
      },
      {
        key: "showNotificationBadge",
        title: "Show unread badge in topbar",
        description: "When off, the bell icon never shows a count — visit /alerts to see new events.",
      },
      {
        key: "autoMarkEventsRead",
        title: "Auto-mark events as read on visit",
        description:
          "Marks all unread events as read when you open /alerts. Disable to mark them manually.",
      },
    ],
  },
  {
    label: "Position page",
    items: [
      {
        key: "fetchPositionNews",
        title: "Fetch news on position pages",
        description:
          "Disable to speed up page loads and stop hitting the news API. Already-cached items still show.",
      },
      {
        key: "fetchPositionFundamentals",
        title: "Fetch fundamentals on position pages",
        description: "Disable to skip Finnhub calls for company profile + metrics on each visit.",
      },
    ],
  },
  {
    label: "Dashboard",
    items: [
      {
        key: "showAllocationDonut",
        title: "Show allocation donut",
        description: "Display the holdings breakdown chart between stats and the holdings table.",
      },
    ],
  },
];

export function PreferencesSection({ initial }: { initial: UserPreferences }) {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            {group.label}
          </div>
          <div className="space-y-2">
            {group.items.map((item) => (
              <PreferenceRow key={item.key} item={item} initialValue={initial[item.key]} />
            ))}
          </div>
        </div>
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
