/**
 * Resolve the canonical app URL across envs. Better-auth needs a fully
 * qualified URL — bare hostnames (which Vercel's `VERCEL_URL` provides, and
 * which users often paste into `NEXT_PUBLIC_APP_URL`) break it. This
 * normalizes by prepending `https://` when the value lacks a scheme.
 */
export function resolveBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}
