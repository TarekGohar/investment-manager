-- CreateEnum
CREATE TYPE "ThesisStatus" AS ENUM ('ACTIVE', 'TRIMMED', 'EXITED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "investment_policy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetAllocation" JSONB NOT NULL DEFAULT '{}',
    "targetGeography" JSONB NOT NULL DEFAULT '{}',
    "driftThresholdPct" DECIMAL(5,2),
    "panicSellDrawdownPct" DECIMAL(5,2),
    "panicSellWindowDays" INTEGER,
    "fomoBuyRunupPct" DECIMAL(5,2),
    "fomoBuyWindowDays" INTEGER,
    "overtradingPerMonth" INTEGER,
    "tickerCategories" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thesis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "invalidationCriteria" TEXT,
    "priceTargetCad" DECIMAL(18,4),
    "horizonMonths" INTEGER,
    "status" "ThesisStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastAiReview" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investment_policy_userId_key" ON "investment_policy"("userId");

-- CreateIndex
CREATE INDEX "thesis_userId_status_idx" ON "thesis"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "thesis_userId_ticker_key" ON "thesis"("userId", "ticker");

-- AddForeignKey
ALTER TABLE "investment_policy" ADD CONSTRAINT "investment_policy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thesis" ADD CONSTRAINT "thesis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
