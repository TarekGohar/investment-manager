/**
 * Client-side custom events used to keep server-seeded UI in sync without a
 * full route refresh.
 */

/**
 * Fired on `window` after any AI interaction that spends tokens (e.g. a chat
 * stream finishing). The navbar token/cost counter listens for this and
 * refetches `/api/ai/usage` so the number stays live.
 */
export const AI_USAGE_REFRESH_EVENT = "ai-usage:refresh";
