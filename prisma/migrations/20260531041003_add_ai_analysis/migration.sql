-- CreateEnum
CREATE TYPE "AnalysisKind" AS ENUM ('EOD_DAILY', 'WEEKLY', 'ON_ALERT');

-- CreateTable
CREATE TABLE "ai_analysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AnalysisKind" NOT NULL,
    "ticker" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "metrics" JSONB,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_analysis_userId_kind_generatedAt_idx" ON "ai_analysis"("userId", "kind", "generatedAt" DESC);

-- CreateIndex
CREATE INDEX "ai_analysis_userId_generatedAt_idx" ON "ai_analysis"("userId", "generatedAt" DESC);

-- AddForeignKey
ALTER TABLE "ai_analysis" ADD CONSTRAINT "ai_analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
