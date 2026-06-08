import "server-only";
import { createDecisionEvent } from "@/lib/alerts/hub";
import type { ToolDefinition } from "./types";
import type { AlertSource } from "@/generated/prisma";

/**
 * `propose_decision` tool bound to a review run. When the review prompt
 * identifies a specific actionable item (a trim, an add, a TLH harvest, a
 * rebalance leg, etc.) the model calls this to write a structured Hub event
 * linked back to the review via `reviewId`.
 */
export function buildReviewProposeTool(args: {
  userId: string;
  source: Extract<AlertSource, "WEEKLY_REVIEW" | "ANNUAL_REVIEW">;
  reviewId: string;
}): ToolDefinition {
  const { userId, source, reviewId } = args;
  return {
    name: "propose_decision",
    description:
      "Write a decision into the user's Alerts inbox. Use this when your review identifies a specific actionable item: a concrete buy/sell/trim/rebalance/harvest. Three fields carry value: WHAT (action + ticker), WHY (one coherent `rationale` paragraph that absorbs the thesis reasoning, the falsifier as a clause, and the review trigger as a clause — do NOT split these into separate sections), and DEGREE (numbers only in `sizingDetails`: targetWeightPct, currentWeightPct, expectedSharesDelta, expectedDollarDelta). Do NOT call this for general commentary or 'worth watching' items.",
    parameters: {
      type: "object",
      properties: {
        ticker: {
          type: ["string", "null"],
          description: "Ticker the decision is about. Null for portfolio-level (rebalance, cash deployment).",
        },
        recommendedAction: {
          type: "string",
          enum: [
            "ADD",
            "TRIM",
            "EXIT",
            "HOLD_THROUGH_DRAWDOWN",
            "DEPLOY_ELSEWHERE",
            "HARVEST_LOSS",
            "REBALANCE",
          ],
          description: "Must be concrete. If the conclusion is 'the user should think about this' without a specific trade, don't call propose_decision — write it in your prose instead.",
        },
        urgency: {
          type: "string",
          enum: ["INFO", "MATERIAL", "URGENT"],
          description: "MATERIAL by default (implicit baseline). URGENT only with real time-decay (TLH window closing, ex-div Monday, earnings within 48h). INFO for low-priority watch items.",
        },
        message: {
          type: "string",
          description: "One-line summary for the inbox card.",
        },
        rationale: {
          type: "string",
          description: "ONE coherent paragraph (3-6 sentences). Includes the why, the falsifier as a clause ('I'd reverse this if X'), and the review trigger as a clause ('revisit after the Sept 3 print'). Cite numbers verbatim from the data.",
        },
        sizingDetails: {
          type: "object",
          description: "Structured DEGREE numbers: targetWeightPct, currentWeightPct, expectedSharesDelta (negative for sells), expectedDollarDelta (negative for freed cash). Use the keys that apply.",
          properties: {
            targetWeightPct: { type: "number" },
            currentWeightPct: { type: "number" },
            expectedSharesDelta: { type: "number" },
            expectedDollarDelta: { type: "number" },
          },
          additionalProperties: true,
        },
        reviewByDate: {
          type: "string",
          description: "ISO date YYYY-MM-DD for the countdown footer.",
        },
      },
      required: ["recommendedAction", "message", "rationale"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const args = input as Record<string, unknown>;
      const reviewByStr = typeof args.reviewByDate === "string" ? args.reviewByDate : undefined;
      const reviewByDate = reviewByStr ? new Date(reviewByStr) : null;
      try {
        const event = await createDecisionEvent({
          userId,
          source,
          reviewId,
          ticker: typeof args.ticker === "string" ? args.ticker : null,
          message: String(args.message ?? ""),
          recommendedAction: args.recommendedAction as Parameters<typeof createDecisionEvent>[0]["recommendedAction"],
          urgency: (typeof args.urgency === "string" ? args.urgency : "MATERIAL") as Parameters<typeof createDecisionEvent>[0]["urgency"],
          rationale: typeof args.rationale === "string" ? args.rationale : null,
          sizingDetails: (args.sizingDetails as Record<string, unknown> | undefined) ?? null,
          reviewByDate: reviewByDate && !isNaN(reviewByDate.getTime()) ? reviewByDate : null,
        });
        return { ok: true, decisionId: event.id, url: `/decisions/${event.id}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to record decision.";
        return { ok: false, error: msg };
      }
    },
  };
}
