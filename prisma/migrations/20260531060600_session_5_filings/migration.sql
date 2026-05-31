-- CreateEnum
CREATE TYPE "FilingType" AS ENUM ('TEN_K', 'TEN_Q', 'EIGHT_K', 'ANNUAL_INFO_FORM', 'MD_AND_A', 'ANNUAL_FINANCIAL_STATEMENTS', 'INTERIM_FINANCIAL_STATEMENTS', 'MATERIAL_CHANGE_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "FilingSource" AS ENUM ('EDGAR', 'SEDAR_PLUS');

-- AlterEnum
ALTER TYPE "AnalysisKind" ADD VALUE 'QUARTERLY_DEEP';

-- CreateTable
CREATE TABLE "filing" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "type" "FilingType" NOT NULL,
    "source" "FilingSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "body" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filing_ticker_filedAt_idx" ON "filing"("ticker", "filedAt" DESC);

-- CreateIndex
CREATE INDEX "filing_ticker_type_filedAt_idx" ON "filing"("ticker", "type", "filedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "filing_source_externalId_key" ON "filing"("source", "externalId");
