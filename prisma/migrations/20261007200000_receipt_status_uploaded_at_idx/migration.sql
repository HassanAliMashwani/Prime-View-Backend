-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReceiptSubmission_status_uploadedAt_idx" ON "ReceiptSubmission"("status", "uploadedAt");
