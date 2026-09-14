-- Replace Booking FOR ALL with specific policies
DROP POLICY IF EXISTS booking_block_scope ON "Booking";

CREATE POLICY booking_select_update_delete ON "Booking"
  FOR ALL
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "customerId" = current_setting('app.current_customer_id', true)
    OR "plotId" IN (
      SELECT id FROM "Plot" WHERE "blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

CREATE POLICY booking_insert_scope ON "Booking"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.can_book', true) = 'true'
  );
