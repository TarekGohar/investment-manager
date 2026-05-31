-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FilingSource" ADD VALUE 'CSE';
ALTER TYPE "FilingSource" ADD VALUE 'TMX';

-- CreateTable
CREATE TABLE "ticker_listing" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "name" TEXT,
    "cik" TEXT,
    "cseIssuerId" TEXT,
    "cseSlug" TEXT,
    "tmxSymbol" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticker_listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticker_listing_ticker_key" ON "ticker_listing"("ticker");
