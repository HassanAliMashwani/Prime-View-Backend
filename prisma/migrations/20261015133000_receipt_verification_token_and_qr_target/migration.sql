-- AlterTable
ALTER TABLE "ReceiptSubmission" ADD COLUMN "verificationToken" TEXT,
ADD COLUMN "qrTarget" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSubmission_verificationToken_key" ON "ReceiptSubmission"("verificationToken");
