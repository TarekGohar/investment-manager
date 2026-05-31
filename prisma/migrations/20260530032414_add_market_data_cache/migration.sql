-- CreateTable
CREATE TABLE "quote" (
    "ticker" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "change" DECIMAL(18,4) NOT NULL,
    "changePct" DECIMAL(10,4) NOT NULL,
    "prevClose" DECIMAL(18,4) NOT NULL,
    "open" DECIMAL(18,4),
    "high" DECIMAL(18,4),
    "low" DECIMAL(18,4),
    "asOf" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'finnhub',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("ticker")
);

-- CreateTable
CREATE TABLE "news_item" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundamentals" (
    "ticker" TEXT NOT NULL,
    "companyName" TEXT,
    "industry" TEXT,
    "exchange" TEXT,
    "marketCap" DECIMAL(20,2),
    "peTtm" DECIMAL(10,2),
    "forwardPe" DECIMAL(10,2),
    "dividendYield" DECIMAL(8,6),
    "beta" DECIMAL(8,4),
    "fiftyTwoHigh" DECIMAL(18,4),
    "fiftyTwoLow" DECIMAL(18,4),
    "logo" TEXT,
    "weburl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundamentals_pkey" PRIMARY KEY ("ticker")
);

-- CreateTable
CREATE TABLE "candle" (
    "ticker" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(18,4) NOT NULL,
    "high" DECIMAL(18,4) NOT NULL,
    "low" DECIMAL(18,4) NOT NULL,
    "close" DECIMAL(18,4) NOT NULL,
    "volume" BIGINT NOT NULL,

    CONSTRAINT "candle_pkey" PRIMARY KEY ("ticker","ts")
);

-- CreateIndex
CREATE INDEX "news_item_ticker_publishedAt_idx" ON "news_item"("ticker", "publishedAt");

-- CreateIndex
CREATE INDEX "candle_ticker_ts_idx" ON "candle"("ticker", "ts");
