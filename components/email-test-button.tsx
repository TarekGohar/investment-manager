"use client";

import { useTransition } from "react";
import { sendTestEmailAction } from "@/app/actions/email";
import { useToast } from "@/components/toast-provider";

export function EmailTestButton({ configured }: { configured: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (pending) return;
    startTransition(async () => {
      const result = await sendTestEmailAction();
      if (!result.ok) {
        toast({ title: "Send failed", description: result.error, variant: "error" });
        return;
      }
      if (result.status === "sent") {
        toast({ title: "Test email sent", description: "Check your inbox.", variant: "success" });
      } else {
        toast({
          title: "Printed to dev console",
          description: "Resend isn't configured — the message went to your server log instead.",
          variant: "info",
        });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-[10px] bg-pill px-3 py-1.5 text-[12px] font-semibold text-text transition-colors hover:bg-panel-2 disabled:opacity-60"
    >
      {pending ? "Sending…" : configured ? "Send test email" : "Send test (console)"}
    </button>
  );
}
