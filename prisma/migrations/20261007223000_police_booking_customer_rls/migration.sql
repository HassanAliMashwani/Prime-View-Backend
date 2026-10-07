-- Update Customer RLS policies to permit booking by sub-admins with can_book = 'true'
DROP POLICY IF EXISTS customer_insert_scope ON "Customer";
CREATE POLICY customer_insert_scope ON "Customer"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.can_create_customer', true) = 'true'
    OR current_setting('app.can_book', true) = 'true'
  );

DROP POLICY IF EXISTS customer_update_scope ON "Customer";
CREATE POLICY customer_update_scope ON "Customer"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_customer_id', true)
    OR current_setting('app.current_role', true) = ''
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND current_setting('app.can_book', true) = 'true'
    )
    OR id IN (
      SELECT "customerId" FROM "Booking" WHERE "plotId" IN (
        SELECT id FROM "Plot" WHERE "blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
  );
