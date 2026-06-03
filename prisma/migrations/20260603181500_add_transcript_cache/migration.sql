-- CreateTable
CREATE TABLE "transcript" (
    "ticker" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "title" TEXT,
    "segments" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'alphavantage',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_pkey" PRIMARY KEY ("ticker","quarter")
);
