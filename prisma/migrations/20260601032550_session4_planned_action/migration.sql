-- CreateEnum
CREATE TYPE "PlannedActionKind" AS ENUM ('TLH_HARVEST', 'REBALANCE', 'THESIS_REEVALUATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertRule" ADD VALUE 'TLH_OPPORTUNITY';
ALTER TYPE "AlertRule" ADD VALUE 'REBALANCE_DUE';
ALTER TYPE "AlertRule" ADD VALUE 'THESIS_INVALIDATION_CANDIDATE';

-- CreateTable
CREATE TABLE "planned_action" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PlannedActionKind" NOT NULL,
    "ticker" TEXT,
    "payload" JSONB NOT NULL,
    "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "sourceAlertEventId" TEXT,

    CONSTRAINT "planned_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planned_action_userId_fulfilledAt_dismissedAt_idx" ON "planned_action"("userId", "fulfilledAt", "dismissedAt");

-- CreateIndex
CREATE INDEX "planned_action_userId_ticker_kind_idx" ON "planned_action"("userId", "ticker", "kind");

-- AddForeignKey
ALTER TABLE "planned_action" ADD CONSTRAINT "planned_action_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
