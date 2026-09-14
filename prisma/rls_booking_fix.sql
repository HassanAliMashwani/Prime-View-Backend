DROP POLICY IF EXISTS booking_select_update_delete ON "Booking";

CREATE POLICY booking_select_scope ON "Booking"
  FOR SELECT
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

CREATE POLICY booking_update_scope ON "Booking"
  FOR UPDATE
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

CREATE POLICY booking_delete_scope ON "Booking"
  FOR DELETE
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
