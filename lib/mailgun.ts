type Params = {
  email: string;
  url: string;
};

export async function sendMagicLinkEmail({ email, url }: Params): Promise<void> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAILGUN_FROM ?? (domain ? `Portfolio <noreply@${domain}>` : null);

  // Dev fallback: print the link so you can sign in without configuring Mailgun
  if (!apiKey || !domain || !from) {
    console.log("\n" + "─".repeat(64));
    console.log(`📬  Magic link for ${email}`);
    console.log(`🔗  ${url}`);
    console.log("─".repeat(64) + "\n");
    return;
  }

  const body = new URLSearchParams({
    from,
    to: email,
    subject: "Sign in to Portfolio",
    text: `Click the link below to sign in.\n\n${url}\n\nThis link expires in 10 minutes and can only be used once. If you didn't request it, you can ignore this email.`,
    html: htmlTemplate({ url }),
  });

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Mailgun send failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

function htmlTemplate({ url }: { url: string }) {
  return `<!doctype html>
<html><body style="margin:0;padding:40px 0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;">
        <tr><td style="padding:40px;">
          <div style="font-size:22px;font-weight:600;color:#0a0b0d;margin-bottom:18px;">Sign in to Portfolio</div>
          <div style="font-size:15px;line-height:1.6;color:#5b616e;margin-bottom:28px;">
            Click the button below to finish signing in. This link expires in 10 minutes and can only be used once.
          </div>
          <a href="${url}" style="display:inline-block;background:linear-gradient(90deg,#4a82f7,#6f6cf6);color:#ffffff;font-weight:600;text-decoration:none;padding:14px 24px;border-radius:24px;font-size:15px;">Sign in</a>
          <div style="margin-top:32px;font-size:13px;color:#8a919e;">
            If you didn't request this, you can safely ignore the email.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
