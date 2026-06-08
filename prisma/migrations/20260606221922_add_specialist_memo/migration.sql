-- CreateTable
CREATE TABLE "specialist_memo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specialist" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "memo" JSONB NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specialist_memo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "specialist_memo_userId_ticker_asOf_idx" ON "specialist_memo"("userId", "ticker", "asOf" DESC);

-- CreateIndex
CREATE INDEX "specialist_memo_userId_specialist_ticker_idx" ON "specialist_memo"("userId", "specialist", "ticker");

-- AddForeignKey
ALTER TABLE "specialist_memo" ADD CONSTRAINT "specialist_memo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
