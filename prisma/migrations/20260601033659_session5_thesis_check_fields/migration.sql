-- AlterTable
ALTER TABLE "thesis" ADD COLUMN     "lastInvalidationCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastInvalidationConfidence" INTEGER,
ADD COLUMN     "lastInvalidationReasoning" TEXT;
