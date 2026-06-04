"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAlertEventReadAction } from "@/app/actions/decisions";
import { useToast } from "@/components/toast-provider";

/**
 * Side panel for notification-only AlertEvents (no recommendedAction). The
 * user can mark the notification read. If they decide it warrants action,
 * they raise a decision from the relevant position page — keeps the
 * "decisions are deliberate" contract intact.
 */
export function NotificationActionPanel({
  eventId,
  read,
}: {
  eventId: string;
  read: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function markRead() {
    startTransition(async () => {
      const result = await markAlertEventReadAction({ eventId });
      if (result.ok) {
        toast({ title: "Marked as read", variant: "success" });
        router.refresh();
      } else {
        toast({ title: "Couldn't mark", description: result.error, variant: "error" });
      }
    });
  }

  return (
    <section className="rounded-card border border-border bg-panel p-5">
      <h3 className="text-sm font-semibold">Notification</h3>
      <p className="mt-2 text-xs text-muted">
        This is an FYI from a cron rule. No action is implied. If you want to track this as
        something you&apos;ll act on, raise a manual decision from the position page or in chat.
      </p>
      {!read && (
        <button
          type="button"
          onClick={markRead}
          disabled={pending}
          className="mt-4 w-full rounded-[8px] border border-border bg-panel px-3 py-2 text-sm font-semibold transition-colors hover:border-border-2 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Mark as read"}
        </button>
      )}
      {read && (
        <p className="mt-4 rounded-[8px] bg-bg/40 px-3 py-2 text-xs text-muted">
          Already marked as read.
        </p>
      )}
    </section>
  );
}
