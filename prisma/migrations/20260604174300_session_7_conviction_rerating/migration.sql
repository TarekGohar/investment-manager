-- AlterTable
ALTER TABLE "thesis" ADD COLUMN     "convictionNotes" TEXT,
ADD COLUMN     "convictionRatedAt" TIMESTAMP(3),
ADD COLUMN     "convictionRating" INTEGER;

-- CreateTable
CREATE TABLE "conviction_history" (
    "id" TEXT NOT NULL,
    "thesisId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "notes" TEXT,
    "source" "AlertSource" NOT NULL DEFAULT 'MANUAL',
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conviction_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conviction_history_thesisId_ratedAt_idx" ON "conviction_history"("thesisId", "ratedAt" DESC);

-- CreateIndex
CREATE INDEX "thesis_convictionRatedAt_idx" ON "thesis"("convictionRatedAt");

-- AddForeignKey
ALTER TABLE "conviction_history" ADD CONSTRAINT "conviction_history_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "thesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
