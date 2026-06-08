-- Drop the deprecated AlertEvent fields. The schema was simplified to three
-- pieces of value per decision: WHAT (recommendedAction + ticker), WHY (one
-- coherent `rationale` paragraph), and DEGREE (structured numbers in
-- `sizingDetails`). The fields below were split-prose parallels of those
-- concepts that produced visual brick + no retrospective value.
ALTER TABLE "alert_event"
  DROP COLUMN "actionDetails",
  DROP COLUMN "sizingRationale",
  DROP COLUMN "supportingEvidence",
  DROP COLUMN "alternativesConsidered",
  DROP COLUMN "invalidationTrigger",
  DROP COLUMN "reviewEvent";
