-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReceiptSubmission_status_uploadedAt_idx" ON "ReceiptSubmission"("status", "uploadedAt");

-- Update Customer RLS policies to permit booking by sub-admins with can_book = 'true'
DROP POLICY IF EXISTS customer_insert_scope ON "Customer";
CREATE POLICY customer_insert_scope ON "Customer"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_user_role', true) = 'super_admin'
    OR (
      current_setting('app.current_user_role', true) = 'sub_admin'
      AND (
        current_setting('app.current_user_permissions_can_create_customer', true) = 'true'
        OR current_setting('app.current_user_permissions_can_book', true) = 'true'
      )
    )
  );

DROP POLICY IF EXISTS customer_update_scope ON "Customer";
CREATE POLICY customer_update_scope ON "Customer"
  FOR UPDATE
  USING (
    current_setting('app.current_user_role', true) = 'super_admin'
    OR (
      current_setting('app.current_user_role', true) = 'sub_admin'
      AND (
        current_setting('app.current_user_permissions_can_create_customer', true) = 'true'
        OR current_setting('app.current_user_permissions_can_book', true) = 'true'
      )
    )
  );
