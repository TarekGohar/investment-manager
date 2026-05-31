-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FilingType" ADD VALUE 'FORTY_F';
ALTER TYPE "FilingType" ADD VALUE 'SIX_K';
ALTER TYPE "FilingType" ADD VALUE 'TWENTY_F';
ALTER TYPE "FilingType" ADD VALUE 'F_10';
ALTER TYPE "FilingType" ADD VALUE 'F_X';
ALTER TYPE "FilingType" ADD VALUE 'F_3';
