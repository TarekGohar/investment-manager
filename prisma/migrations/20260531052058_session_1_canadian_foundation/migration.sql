-- CreateEnum
CREATE TYPE "BrokerageKind" AS ENUM ('NON_REGISTERED', 'JOINT_NON_REGISTERED', 'TFSA', 'RRSP', 'FHSA', 'RESP', 'LIRA', 'RRIF', 'CORPORATE');

-- AlterTable
ALTER TABLE "brokerage" ADD COLUMN     "kind" "BrokerageKind" NOT NULL DEFAULT 'NON_REGISTERED',
ALTER COLUMN "currency" SET DEFAULT 'CAD';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "foreignTaxWithheld" DECIMAL(18,4);

-- CreateTable
CREATE TABLE "contribution_room" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "BrokerageKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "roomAvailable" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contribution_room_userId_idx" ON "contribution_room"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_room_userId_kind_year_key" ON "contribution_room"("userId", "kind", "year");

-- AddForeignKey
ALTER TABLE "contribution_room" ADD CONSTRAINT "contribution_room_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
