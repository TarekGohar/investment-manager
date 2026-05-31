-- CreateEnum
CREATE TYPE "AlertRule" AS ENUM ('PRICE_MOVE', 'DRAWDOWN', 'CONCENTRATION');

-- CreateEnum
CREATE TYPE "AlertScope" AS ENUM ('PORTFOLIO', 'HOLDING', 'TICKER');

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rule" "AlertRule" NOT NULL,
    "scope" "AlertScope" NOT NULL,
    "ticker" TEXT,
    "params" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" JSONB NOT NULL DEFAULT '["IN_APP"]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_event" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alert_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_userId_enabled_idx" ON "alert"("userId", "enabled");

-- CreateIndex
CREATE INDEX "alert_event_userId_firedAt_idx" ON "alert_event"("userId", "firedAt" DESC);

-- CreateIndex
CREATE INDEX "alert_event_userId_read_idx" ON "alert_event"("userId", "read");

-- CreateIndex
CREATE INDEX "alert_event_alertId_ticker_firedAt_idx" ON "alert_event"("alertId", "ticker", "firedAt" DESC);

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
