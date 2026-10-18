-- Nullify paymentRecordId on ReceiptSubmission if any point to admission_fee or share_subscription_fee
UPDATE "ReceiptSubmission"
SET "paymentRecordId" = NULL
WHERE "paymentRecordId" IN (
  SELECT "id" FROM "PaymentRecord"
  WHERE "feeType"::text IN ('admission_fee', 'share_subscription_fee')
);

-- Delete PaymentAllocation records pointing to admission_fee or share_subscription_fee
DELETE FROM "PaymentAllocation"
WHERE "paymentRecordId" IN (
  SELECT "id" FROM "PaymentRecord"
  WHERE "feeType"::text IN ('admission_fee', 'share_subscription_fee')
);

-- Delete PaymentRecord rows of only those two fee types
DELETE FROM "PaymentRecord"
WHERE "feeType"::text IN ('admission_fee', 'share_subscription_fee');
