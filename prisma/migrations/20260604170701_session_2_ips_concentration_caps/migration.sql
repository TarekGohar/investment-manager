-- AlterTable
ALTER TABLE "investment_policy" ADD COLUMN     "capReasoning" TEXT,
ADD COLUMN     "maxSingleNameWeightPct" DECIMAL(5,2),
ADD COLUMN     "maxThemeWeightPct" DECIMAL(5,2);
