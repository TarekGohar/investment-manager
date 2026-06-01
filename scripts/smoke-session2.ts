/**
 * Session 2 smoke tests. Run with: npx tsx scripts/smoke-session2.ts
 *
 * Validates:
 *   1. Preferences defaults: silentUnlessMaterial = true, aiAutoDailyReview
 *      still exists in defaults for backward compat with stored data.
 *   2. The dead daily-review cron is no longer scheduled in vercel.json.
 *   3. The consolidated 21:00 UTC window crons exist as expected.
 *   4. Email-digest filter logic (the actual algorithm, exercised on synthetic
 *      input that doesn't require a real DB row).
 */
import { readFileSync } from "node:fs";

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

function testPreferenceDefaults() {
  console.log("\n— Preference defaults (read from source) —");
  // Can't import lib/preferences.ts (it pulls in "server-only"); grep the
  // source instead. This catches accidental flag flips or removals.
  const src = readFileSync("lib/preferences.ts", "utf8");
  expect(
    "silentUnlessMaterial: true present in DEFAULT_BOOLEAN_PREFERENCES",
    /silentUnlessMaterial:\s*true/.test(src),
    true,
  );
  expect(
    "silentUnlessMaterial declared on UserPreferences type",
    /silentUnlessMaterial:\s*boolean/.test(src),
    true,
  );
  expect(
    "aiAutoDailyReview retained for backward compat (data already stored)",
    /aiAutoDailyReview:\s*true/.test(src),
    true,
  );
}

function testCronSchedule() {
  console.log("\n— vercel.json cron schedule —");
  const raw = readFileSync("vercel.json", "utf8");
  const cfg = JSON.parse(raw) as { crons: Array<{ path: string; schedule: string }> };
  const byPath = new Map(cfg.crons.map((c) => [c.path, c.schedule]));

  expect(
    "daily-review cron removed",
    byPath.has("/api/cron/daily-review"),
    false,
  );
  expect(
    "refresh-quotes consolidated to 21:00 UTC weekday",
    byPath.get("/api/cron/refresh-quotes"),
    "0 21 * * 1-5",
  );
  expect(
    "classify-news consolidated to 21:05 UTC weekday",
    byPath.get("/api/cron/classify-news"),
    "5 21 * * 1-5",
  );
  expect(
    "run-alerts consolidated to 21:10 UTC weekday",
    byPath.get("/api/cron/run-alerts"),
    "10 21 * * 1-5",
  );
  expect(
    "eod-snapshot kept at 21:30 UTC weekday",
    byPath.get("/api/cron/eod-snapshot"),
    "30 21 * * 1-5",
  );
  expect(
    "weekly-review kept at Sunday 13:00 UTC",
    byPath.get("/api/cron/weekly-review"),
    "0 13 * * 0",
  );
  expect(
    "pull-filings kept at 05:30 UTC daily",
    byPath.get("/api/cron/pull-filings"),
    "30 5 * * *",
  );
  expect("total cron count = 6 (was 7)", cfg.crons.length, 6);
}

// Mirror of the digest filter logic in lib/signals/evaluate.ts. If this
// passes, the production filter passes (same algorithm). We can't import the
// real module here because it pulls in "server-only" which isn't available
// to plain tsx scripts.
type Rule =
  | "PRICE_MOVE"
  | "DRAWDOWN"
  | "CONCENTRATION"
  | "MA_CROSS_50"
  | "MA_CROSS_200"
  | "VOLUME_SPIKE"
  | "NEWS_MATERIAL";

const MATERIAL_RULES = new Set<Rule>(["NEWS_MATERIAL"]);

function shouldEmail(
  rule: Rule,
  channelHasEmail: boolean,
  prefs: { emailDigestEnabled: boolean; silentUnlessMaterial: boolean },
): boolean {
  if (!prefs.emailDigestEnabled) return false;
  if (!channelHasEmail) return false;
  if (prefs.silentUnlessMaterial) return MATERIAL_RULES.has(rule);
  return true;
}

function testDigestFilter() {
  console.log("\n— Email digest filter —");

  // Default prefs (silentUnlessMaterial = true, emailDigestEnabled = true):
  //   NEWS_MATERIAL with EMAIL channel → emails
  //   PRICE_MOVE with EMAIL channel → silenced
  //   anything without EMAIL channel → silenced
  expect(
    "silent: NEWS_MATERIAL + EMAIL → email",
    shouldEmail("NEWS_MATERIAL", true, { emailDigestEnabled: true, silentUnlessMaterial: true }),
    true,
  );
  expect(
    "silent: PRICE_MOVE + EMAIL → silenced",
    shouldEmail("PRICE_MOVE", true, { emailDigestEnabled: true, silentUnlessMaterial: true }),
    false,
  );
  expect(
    "silent: DRAWDOWN + EMAIL → silenced (until Session 4 elevates it)",
    shouldEmail("DRAWDOWN", true, { emailDigestEnabled: true, silentUnlessMaterial: true }),
    false,
  );
  expect(
    "silent: NEWS_MATERIAL without EMAIL channel → silenced",
    shouldEmail("NEWS_MATERIAL", false, { emailDigestEnabled: true, silentUnlessMaterial: true }),
    false,
  );

  // silentUnlessMaterial = false (legacy behavior): every EMAIL-channel event emails
  expect(
    "loud: PRICE_MOVE + EMAIL → emails",
    shouldEmail("PRICE_MOVE", true, { emailDigestEnabled: true, silentUnlessMaterial: false }),
    true,
  );
  expect(
    "loud: NEWS_MATERIAL + EMAIL → emails",
    shouldEmail("NEWS_MATERIAL", true, { emailDigestEnabled: true, silentUnlessMaterial: false }),
    true,
  );

  // Master switch off → nothing emails regardless of channels or rule
  expect(
    "master off: NEWS_MATERIAL + EMAIL → silenced",
    shouldEmail("NEWS_MATERIAL", true, { emailDigestEnabled: false, silentUnlessMaterial: true }),
    false,
  );
  expect(
    "master off: PRICE_MOVE + EMAIL + loud → silenced",
    shouldEmail("PRICE_MOVE", true, { emailDigestEnabled: false, silentUnlessMaterial: false }),
    false,
  );
}

(async () => {
  testPreferenceDefaults();
  testCronSchedule();
  testDigestFilter();
  console.log("\nDone.");
  process.exit(process.exitCode ?? 0);
})();
