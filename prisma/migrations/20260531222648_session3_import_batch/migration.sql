-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "importBatchId" TEXT;

-- CreateTable
CREATE TABLE "import_batch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerageId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'RBC_DI',
    "sourceFilename" TEXT NOT NULL,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batch_userId_importedAt_idx" ON "import_batch"("userId", "importedAt" DESC);

-- CreateIndex
CREATE INDEX "transaction_importBatchId_idx" ON "transaction"("importBatchId");

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
