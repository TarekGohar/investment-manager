-- CreateEnum
CREATE TYPE "SellReason" AS ENUM ('REBALANCE_DRIFT', 'THESIS_INVALIDATED', 'TLH_HARVEST', 'TAX_PLANNING', 'CASH_NEED', 'DISCRETIONARY');

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "fxRateToCad" DECIMAL(18,8),
ADD COLUMN     "isDrip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reasonCode" "SellReason";

-- CreateTable
CREATE TABLE "fx_rate" (
    "currency" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "asOf" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BOC_VALET',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rate_pkey" PRIMARY KEY ("currency","date")
);
