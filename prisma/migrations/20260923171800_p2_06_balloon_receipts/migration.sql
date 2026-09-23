-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('regular', 'balloon');

-- AlterTable
ALTER TABLE "ReceiptSubmission" ADD COLUMN "paymentKind" "PaymentKind" DEFAULT 'regular',
ADD COLUMN "previewData" JSONB;

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "paymentRecordId" TEXT NOT NULL,
    "amountApplied" DOUBLE PRECISION NOT NULL,
    "allocationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ReceiptSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "PaymentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
