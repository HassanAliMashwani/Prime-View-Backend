DROP POLICY IF EXISTS reservation_block_scope ON "Reservation";

CREATE POLICY reservation_select_scope ON "Reservation"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "plotId" IN (
      SELECT id FROM "Plot" WHERE "blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

CREATE POLICY reservation_update_scope ON "Reservation"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "plotId" IN (
      SELECT id FROM "Plot" WHERE "blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

CREATE POLICY reservation_delete_scope ON "Reservation"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "plotId" IN (
      SELECT id FROM "Plot" WHERE "blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

CREATE POLICY reservation_insert_scope ON "Reservation"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.can_reserve', true) = 'true'
  );

-- Also fix customer update policy from Fix 1
DROP POLICY IF EXISTS customer_update_scope ON "Customer";

CREATE POLICY customer_update_scope ON "Customer"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_customer_id', true)
    OR id IN (
      SELECT "customerId" FROM "Booking" WHERE "plotId" IN (
        SELECT id FROM "Plot" WHERE "blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
  );
