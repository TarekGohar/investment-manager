-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateTable
CREATE TABLE "brokerage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brokerage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerageId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "fees" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "splitRatio" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brokerage_userId_idx" ON "brokerage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_userId_name_key" ON "brokerage"("userId", "name");

-- CreateIndex
CREATE INDEX "transaction_userId_ticker_occurredAt_idx" ON "transaction"("userId", "ticker", "occurredAt");

-- CreateIndex
CREATE INDEX "transaction_userId_occurredAt_idx" ON "transaction"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "brokerage" ADD CONSTRAINT "brokerage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_brokerageId_fkey" FOREIGN KEY ("brokerageId") REFERENCES "brokerage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
