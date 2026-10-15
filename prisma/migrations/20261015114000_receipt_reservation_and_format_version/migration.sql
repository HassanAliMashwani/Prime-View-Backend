-- CreateEnum
CREATE TYPE "ReceiptNumberReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ReceiptApprovalIdempotencyStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED', 'STALE');

-- AlterTable
ALTER TABLE "ReceiptSubmission" ADD COLUMN     "slipNumberFormatVersion" INTEGER;

-- CreateTable
CREATE TABLE "ReceiptNumberReservation" (
    "id" TEXT NOT NULL,
    "slipNumber" TEXT NOT NULL,
    "status" "ReceiptNumberReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "receiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptNumberReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptApprovalIdempotency" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "status" "ReceiptApprovalIdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "requestHash" TEXT,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptApprovalIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptNumberReservation_slipNumber_key" ON "ReceiptNumberReservation"("slipNumber");

-- CreateIndex
CREATE INDEX "ReceiptNumberReservation_status_idx" ON "ReceiptNumberReservation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptApprovalIdempotency_key_key" ON "ReceiptApprovalIdempotency"("key");

-- CreateIndex
CREATE INDEX "ReceiptApprovalIdempotency_receiptId_idx" ON "ReceiptApprovalIdempotency"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptApprovalIdempotency_status_idx" ON "ReceiptApprovalIdempotency"("status");

-- Enable and force Row Level Security
ALTER TABLE "ReceiptNumberReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptNumberReservation" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ReceiptApprovalIdempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptApprovalIdempotency" FORCE ROW LEVEL SECURITY;

-- Grants for app_user
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON "ReceiptNumberReservation" TO app_user;
    GRANT SELECT, INSERT, UPDATE ON "ReceiptApprovalIdempotency" TO app_user;
  END IF;
END
$$;

-- RLS Policies
DROP POLICY IF EXISTS receipt_reservation_policy ON "ReceiptNumberReservation";
CREATE POLICY receipt_reservation_policy ON "ReceiptNumberReservation"
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS receipt_idempotency_policy ON "ReceiptApprovalIdempotency";
CREATE POLICY receipt_idempotency_policy ON "ReceiptApprovalIdempotency"
  FOR ALL
  USING (true)
  WITH CHECK (true);
