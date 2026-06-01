/**
 * Smoke test the Resend wiring with the actual API key + FROM address
 * from .env.local. Sends one real email to verify the platform's path
 * end-to-end before any cron fires for real.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });

const RECIPIENT = "tarekgohar@outlook.com";

(async () => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "Portfolio <onboarding@resend.dev>";
  if (!apiKey) {
    console.error("RESEND_API_KEY not set in .env.local");
    process.exit(1);
  }
  console.log(`From:   ${from}`);
  console.log(`To:     ${RECIPIENT}`);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: RECIPIENT,
      subject: "Portfolio · onboarding test (Resend wired up)",
      text: [
        "If you're reading this in your inbox, Resend is live.",
        "",
        "What now works end-to-end:",
        "  · Magic-link sign-in emails will arrive at your address",
        "  · Alert digests (coaching alerts, news, drawdown, etc.) deliver",
        "  · Test button on /settings shows 'Test email sent' instead of",
        "    'Printed to console'",
        "",
        "Once you deploy to Vercel, set the same env vars there and emails",
        "route the same way to any recipient.",
      ].join("\n"),
      html: `<!doctype html><html><body style="margin:0;padding:40px 0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;">
      <tr><td style="padding:32px 36px;">
        <div style="font-size:20px;font-weight:600;color:#0a0b0d;margin-bottom:6px;">Resend is live</div>
        <div style="font-size:13px;color:#8a919e;margin-bottom:24px;">End-to-end test from pm@evelon.io</div>
        <p style="font-size:14px;line-height:1.6;color:#0a0b0d;">If you're reading this in your inbox, the platform can now deliver:</p>
        <ul style="font-size:14px;line-height:1.8;color:#0a0b0d;padding-left:18px;">
          <li>Magic-link sign-in emails</li>
          <li>Coaching alert digests (TLH, rebalance, thesis invalidation)</li>
          <li>User-rule alert digests (drawdown, concentration, news)</li>
        </ul>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Resend send failed (${res.status}):`, text);
    process.exit(1);
  }
  console.log("Resend response:", text);
})();
