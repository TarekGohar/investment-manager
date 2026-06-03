-- AlterTable
ALTER TABLE "ai_analysis" ADD COLUMN     "cacheCreationTokens" INTEGER,
ADD COLUMN     "cachedTokens" INTEGER;

-- AlterTable
ALTER TABLE "ai_message" ADD COLUMN     "cacheCreationTokens" INTEGER,
ADD COLUMN     "cachedTokens" INTEGER;
