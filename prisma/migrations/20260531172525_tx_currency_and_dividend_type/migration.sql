-- CreateEnum
CREATE TYPE "DividendType" AS ENUM ('ELIGIBLE', 'NON_ELIGIBLE', 'INTEREST', 'FOREIGN', 'RETURN_OF_CAPITAL', 'OTHER');

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'CAD',
ADD COLUMN     "dividendType" "DividendType",
ALTER COLUMN "ticker" DROP NOT NULL;
