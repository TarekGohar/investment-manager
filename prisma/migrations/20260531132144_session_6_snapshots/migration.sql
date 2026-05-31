-- CreateTable
CREATE TABLE "portfolio_snapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "totalMarketValue" DECIMAL(18,2) NOT NULL,
    "totalRealized" DECIMAL(18,2) NOT NULL,
    "totalDividends" DECIMAL(18,2) NOT NULL,
    "byKind" JSONB NOT NULL,
    "holdings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_snapshot_userId_date_idx" ON "portfolio_snapshot"("userId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_snapshot_userId_date_key" ON "portfolio_snapshot"("userId", "date");

-- AddForeignKey
ALTER TABLE "portfolio_snapshot" ADD CONSTRAINT "portfolio_snapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
