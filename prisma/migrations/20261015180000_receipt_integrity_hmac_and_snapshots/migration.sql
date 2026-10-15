-- AlterTable
ALTER TABLE "ReceiptSubmission"
ADD COLUMN IF NOT EXISTS "integrityHash" TEXT,
ADD COLUMN IF NOT EXISTS "hashKeyVersion" INTEGER,
ADD COLUMN IF NOT EXISTS "memberNameSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "membershipNumberSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "cnicLast4Snapshot" TEXT,
ADD COLUMN IF NOT EXISTS "plotNumberSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "blockNameSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "amountSnapshot" DECIMAL(14, 2),
ADD COLUMN IF NOT EXISTS "paymentDateSnapshot" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "paymentRecordIdSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "issuedByNameSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "issuedAtSnapshot" TIMESTAMP(3);
