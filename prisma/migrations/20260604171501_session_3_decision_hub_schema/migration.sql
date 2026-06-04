-- CreateEnum
CREATE TYPE "AlertSource" AS ENUM ('CRON_RULE', 'AI_CHAT', 'DAILY_REVIEW', 'WEEKLY_REVIEW', 'ANNUAL_REVIEW', 'MANUAL');

-- CreateEnum
CREATE TYPE "RecommendedAction" AS ENUM ('ADD', 'TRIM', 'EXIT', 'HOLD_THROUGH_DRAWDOWN', 'DEPLOY_ELSEWHERE', 'HARVEST_LOSS', 'REBALANCE', 'REVIEW_THESIS', 'NONE');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('OPEN', 'EXECUTED_AS_RECOMMENDED', 'EXECUTED_REVISED', 'ABANDONED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DecisionUrgency" AS ENUM ('INFO', 'MATERIAL', 'URGENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertRule" ADD VALUE 'AI_PROPOSED_DECISION';
ALTER TYPE "AlertRule" ADD VALUE 'REVIEW_PROPOSED_DECISION';
ALTER TYPE "AlertRule" ADD VALUE 'MANUAL_FLAG';

-- AlterTable
ALTER TABLE "alert_event" ADD COLUMN     "actionDetails" JSONB,
ADD COLUMN     "alternativesConsidered" TEXT,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "invalidationTrigger" TEXT,
ADD COLUMN     "outcome" "DecisionOutcome" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "outcomeExecutedPrice" DECIMAL(18,4),
ADD COLUMN     "outcomeExecutedQuantity" DECIMAL(20,6),
ADD COLUMN     "outcomeNotes" TEXT,
ADD COLUMN     "outcomeRecordedAt" TIMESTAMP(3),
ADD COLUMN     "rationale" TEXT,
ADD COLUMN     "recommendedAction" "RecommendedAction",
ADD COLUMN     "reviewByDate" TIMESTAMP(3),
ADD COLUMN     "reviewEvent" TEXT,
ADD COLUMN     "reviewId" TEXT,
ADD COLUMN     "sizingDetails" JSONB,
ADD COLUMN     "sizingRationale" TEXT,
ADD COLUMN     "source" "AlertSource" NOT NULL DEFAULT 'CRON_RULE',
ADD COLUMN     "supportingEvidence" JSONB,
ADD COLUMN     "urgency" "DecisionUrgency" NOT NULL DEFAULT 'INFO';

-- CreateIndex
CREATE INDEX "alert_event_userId_outcome_urgency_firedAt_idx" ON "alert_event"("userId", "outcome", "urgency", "firedAt" DESC);

-- AddForeignKey
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
