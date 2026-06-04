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
      "Write a decision into the user's Alerts inbox. Use this when your review identifies a specific actionable item: a concrete buy/sell/trim/rebalance/harvest with a rationale, a sizing frame, and an invalidation trigger. Do NOT call this for general commentary or 'worth watching' items — only for things that warrant a tracked decision. Each call writes one Hub entry; you can call this multiple times in a single review when there are multiple actionable items.",
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
          description: "Default MATERIAL for review-raised decisions. URGENT only with real time-decay (TLH window closing, ex-div Monday, earnings within 48h).",
        },
        message: {
          type: "string",
          description: "One-line summary for the inbox card.",
        },
        rationale: {
          type: "string",
          description: "1-3 sentences in PM voice — why now, why this name.",
        },
        actionDetails: {
          type: "object",
          description: "Structured spec: ticker, quantity, priceContext, account.",
          additionalProperties: true,
        },
        sizingRationale: {
          type: "string",
          description: "1-2 sentences on why this size, in NAV terms.",
        },
        sizingDetails: {
          type: "object",
          description: "nominalUsd / pctOfNav / maxLossToInvalidationUsd / etc.",
          additionalProperties: true,
        },
        supportingEvidence: {
          type: "object",
          description: "Snapshot of numbers backing this decision (frozen).",
          additionalProperties: true,
        },
        alternativesConsidered: {
          type: "string",
          description: "What you chose this over. Required for ADD.",
        },
        invalidationTrigger: {
          type: "string",
          description: "What would make THIS decision wrong.",
        },
        reviewEvent: {
          type: "string",
          description: "Human-readable trigger that should bring this back up for review.",
        },
        reviewByDate: {
          type: "string",
          description: "ISO date YYYY-MM-DD.",
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
          actionDetails: (args.actionDetails as Record<string, unknown> | undefined) ?? null,
          sizingRationale: typeof args.sizingRationale === "string" ? args.sizingRationale : null,
          sizingDetails: (args.sizingDetails as Record<string, unknown> | undefined) ?? null,
          supportingEvidence: (args.supportingEvidence as Record<string, unknown> | undefined) ?? null,
          alternativesConsidered: typeof args.alternativesConsidered === "string" ? args.alternativesConsidered : null,
          invalidationTrigger: typeof args.invalidationTrigger === "string" ? args.invalidationTrigger : null,
          reviewEvent: typeof args.reviewEvent === "string" ? args.reviewEvent : null,
          reviewByDate: reviewByDate && !isNaN(reviewByDate.getTime()) ? reviewByDate : null,
        });
        return { ok: true, decisionId: event.id, url: `/alerts/${event.id}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to record decision.";
        return { ok: false, error: msg };
      }
    },
  };
}
