-- AlterEnum
ALTER TYPE "ReceiptStatus" ADD VALUE 'cancelled';
ALTER TYPE "ReceiptStatus" ADD VALUE 'replaced';
ALTER TYPE "ReceiptStatus" ADD VALUE 'payment_reversed';

-- AlterTable
ALTER TABLE "ReceiptSubmission" ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "cancellationReasonCode" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledByAdminId" TEXT,
ADD COLUMN "paymentReversalReasonCode" TEXT,
ADD COLUMN "paymentReversedAt" TIMESTAMP(3),
ADD COLUMN "paymentReversedByAdminId" TEXT,
ADD COLUMN "replacesReceiptId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSubmission_replacesReceiptId_key" ON "ReceiptSubmission"("replacesReceiptId");

-- AddForeignKey
ALTER TABLE "ReceiptSubmission" ADD CONSTRAINT "ReceiptSubmission_replacesReceiptId_fkey" FOREIGN KEY ("replacesReceiptId") REFERENCES "ReceiptSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
