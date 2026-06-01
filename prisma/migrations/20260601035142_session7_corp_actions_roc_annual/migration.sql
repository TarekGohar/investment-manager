-- AlterEnum
ALTER TYPE "AnalysisKind" ADD VALUE 'ANNUAL_REVIEW';

-- AlterEnum
ALTER TYPE "TransactionKind" ADD VALUE 'CORPORATE_ACTION';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "corporateActionPayload" JSONB,
ADD COLUMN     "maturesAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "roc_allocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "eligibleDividendPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "nonEligibleDividendPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "interestPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "returnOfCapitalPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "capitalGainPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "otherPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roc_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roc_allocation_userId_idx" ON "roc_allocation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "roc_allocation_userId_ticker_year_key" ON "roc_allocation"("userId", "ticker", "year");

-- AddForeignKey
ALTER TABLE "roc_allocation" ADD CONSTRAINT "roc_allocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
