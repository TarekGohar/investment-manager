/**
 * Email sender backed by Resend.
 *
 * Resend's free tier (100/day, 3000/month) easily covers a single-user
 * app. The only gotcha is the FROM address — until you verify a domain
 * at resend.com/domains, you can only send from `onboarding@resend.dev`
 * and Resend will only deliver to the email registered on your account
 * (yours, in single-user dev). Once you verify a domain, that limit lifts.
 *
 * Env vars:
 *   RESEND_API_KEY          required for actual delivery
 *   RESEND_FROM             defaults to "Portfolio <onboarding@resend.dev>"
 *
 * Without RESEND_API_KEY, every send silently falls back to a console
 * print so dev still works without an account.
 */

import { resolveBaseUrl } from "@/lib/base-url";

type SendParams = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailStatus = {
  configured: boolean;
  /** The FROM address that'll appear on outbound mail. */
  from: string | null;
  /** Provider name, surfaced in the settings UI. */
  provider: "resend" | "console";
};

const DEFAULT_FROM = "Portfolio <onboarding@resend.dev>";

export function emailStatus(): EmailStatus {
  const configured = Boolean(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM ?? (configured ? DEFAULT_FROM : null);
  return {
    configured,
    from,
    provider: configured ? "resend" : "console",
  };
}

async function send({ to, subject, text, html }: SendParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? DEFAULT_FROM;

  // Dev fallback: print to console so the app works without Resend configured.
  if (!apiKey) {
    console.log("\n" + "─".repeat(64));
    console.log(`📬  ${subject} → ${to}`);
    console.log(text);
    console.log("─".repeat(64) + "\n");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

const APP_URL = resolveBaseUrl();

// ─── Magic link ───────────────────────────────────────────────────────

export async function sendMagicLinkEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  await send({
    to: email,
    subject: "Sign in to Portfolio",
    text: `Click the link below to sign in.\n\n${url}\n\nThis link expires in 10 minutes and can only be used once.`,
    html: signInTemplate({ url }),
  });
}

function signInTemplate({ url }: { url: string }) {
  return `<!doctype html>
<html><body style="margin:0;padding:40px 0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;">
        <tr><td style="padding:40px;">
          <div style="font-size:22px;font-weight:600;color:#0a0b0d;margin-bottom:18px;">Sign in to Portfolio</div>
          <div style="font-size:15px;line-height:1.6;color:#5b616e;margin-bottom:28px;">
            Click the button below to finish signing in. This link expires in 10 minutes.
          </div>
          <a href="${url}" style="display:inline-block;background:linear-gradient(90deg,#4a82f7,#6f6cf6);color:#ffffff;font-weight:600;text-decoration:none;padding:14px 24px;border-radius:24px;font-size:15px;">Sign in</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ─── Alert digest ─────────────────────────────────────────────────────

export type DigestEvent = {
  ticker: string | null;
  message: string;
  firedAt: Date;
};

export async function sendAlertDigest({
  email,
  events,
}: {
  email: string;
  events: DigestEvent[];
}): Promise<void> {
  if (events.length === 0) return;
  const count = events.length;
  const subject =
    count === 1
      ? `Portfolio alert: ${events[0].message.slice(0, 70)}`
      : `Portfolio · ${count} alerts fired`;

  const lines = events.map((e) => `• ${e.message}`);
  const text = `${count} alert${count === 1 ? "" : "s"} fired:\n\n${lines.join("\n")}\n\nOpen the app: ${APP_URL}/decisions`;

  const items = events
    .map((e) => {
      const link = e.ticker
        ? `<a href="${APP_URL}/positions/${e.ticker}" style="color:#3773f5;text-decoration:none;">${e.ticker}</a> · `
        : "";
      const time = e.firedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `<li style="margin-bottom:10px;line-height:1.6;color:#0a0b0d;font-size:14px;">${link}${e.message}<div style="font-size:12px;color:#8a919e;margin-top:2px;">${time}</div></li>`;
    })
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:40px 0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;">
        <tr><td style="padding:32px 36px;">
          <div style="font-size:20px;font-weight:600;color:#0a0b0d;margin-bottom:6px;">Portfolio alerts</div>
          <div style="font-size:13px;color:#8a919e;margin-bottom:24px;">${count} alert${count === 1 ? "" : "s"} fired</div>
          <ul style="list-style:disc;padding-left:18px;margin:0 0 24px 0;">${items}</ul>
          <a href="${APP_URL}/decisions" style="display:inline-block;background:linear-gradient(90deg,#4a82f7,#6f6cf6);color:#ffffff;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:24px;font-size:14px;">Open decisions</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  await send({ to: email, subject, text, html });
}

// ─── Test ────────────────────────────────────────────────────────────

export async function sendTestEmail({ to }: { to: string }): Promise<void> {
  await send({
    to,
    subject: "Portfolio · test email",
    text: "If you can read this, Resend is wired up.",
    html: `<!doctype html>
<html><body style="margin:0;padding:40px 0;background:#f6f7f9;font-family:-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;">
        <tr><td style="padding:32px;color:#0a0b0d;font-size:15px;line-height:1.6;">
          If you can read this, <strong>Resend is wired up</strong>. Alert digests and magic links will route through your verified domain.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  });
}
