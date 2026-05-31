-- CreateEnum
CREATE TYPE "NewsSeverity" AS ENUM ('INFO', 'MATERIAL', 'CRITICAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertRule" ADD VALUE 'MA_CROSS_50';
ALTER TYPE "AlertRule" ADD VALUE 'MA_CROSS_200';
ALTER TYPE "AlertRule" ADD VALUE 'VOLUME_SPIKE';
ALTER TYPE "AlertRule" ADD VALUE 'NEWS_MATERIAL';

-- AlterTable
ALTER TABLE "news_item" ADD COLUMN     "aiSeverity" "NewsSeverity",
ADD COLUMN     "classifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "preferences" JSONB;

-- CreateIndex
CREATE INDEX "news_item_ticker_aiSeverity_idx" ON "news_item"("ticker", "aiSeverity");
