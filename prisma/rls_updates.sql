-- 1. Plot FOR SELECT - Add customer self-access
DROP POLICY IF EXISTS plot_block_scope ON "Plot";
CREATE POLICY plot_block_scope ON "Plot"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR "currentOwnerId" = current_setting('app.current_customer_id', true)
    OR "blockId" IN (
      SELECT "blockId" FROM "BlockAssignment"
      WHERE "adminId" = current_setting('app.current_admin_id', true)
    )
  );

-- 2. Customer FOR SELECT - Add customer self-access
DROP POLICY IF EXISTS customer_block_scope ON "Customer";
CREATE POLICY customer_block_scope ON "Customer"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_customer_id', true)
    OR (
      NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."customerId" = "Customer".id)
      AND (
        current_setting('app.can_create_customer', true) = 'true'
        OR current_setting('app.can_book', true) = 'true'
      )
    )
    OR id IN (
      SELECT "customerId" FROM "Booking" WHERE "plotId" IN (
        SELECT id FROM "Plot" WHERE "blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
    OR id IN (
      SELECT "customerId" FROM "Reservation" WHERE "plotId" IN (
        SELECT id FROM "Plot" WHERE "blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
  );

-- 3. Plot FOR UPDATE
DROP POLICY IF EXISTS plot_update_scope ON "Plot";
CREATE POLICY plot_update_scope ON "Plot"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR "blockId" IN (
      SELECT "blockId" FROM "BlockAssignment"
      WHERE "adminId" = current_setting('app.current_admin_id', true)
    )
  );

-- 4. Plot FOR INSERT
DROP POLICY IF EXISTS plot_insert_scope ON "Plot";
CREATE POLICY plot_insert_scope ON "Plot"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR "blockId" IN (
      SELECT "blockId" FROM "BlockAssignment"
      WHERE "adminId" = current_setting('app.current_admin_id', true)
    )
  );

-- 5. Customer FOR UPDATE
DROP POLICY IF EXISTS customer_update_scope ON "Customer";
CREATE POLICY customer_update_scope ON "Customer"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id IN (
      SELECT "customerId" FROM "Booking" WHERE "plotId" IN (
        SELECT id FROM "Plot" WHERE "blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
  );

-- 6. Customer FOR INSERT (Addendum 2 - Permission backed check)
DROP POLICY IF EXISTS customer_insert_scope ON "Customer";
CREATE POLICY customer_insert_scope ON "Customer"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.can_create_customer', true) = 'true'
  );

-- 7. AuditEntry (Addendum 4 - Replace allow-all with explicit restriction)
DROP POLICY IF EXISTS audit_entry_allow_all ON "AuditEntry";
DROP POLICY IF EXISTS audit_entry_insert_scope ON "AuditEntry";
CREATE POLICY audit_entry_insert_scope ON "AuditEntry"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) IN ('super_admin', 'sub_admin', 'customer', 'system_sweep')
  );

-- 22. PlotStatusHistory FOR SELECT/INSERT (Admins only)
DROP POLICY IF EXISTS plot_status_history_select ON "PlotStatusHistory";
CREATE POLICY plot_status_history_select ON "PlotStatusHistory"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'sub_admin')
  );

DROP POLICY IF EXISTS plot_status_history_insert ON "PlotStatusHistory";
CREATE POLICY plot_status_history_insert ON "PlotStatusHistory"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) IN ('super_admin', 'sub_admin', 'system_sweep')
  );

DROP POLICY IF EXISTS audit_entry_select_scope ON "AuditEntry";
CREATE POLICY audit_entry_select_scope ON "AuditEntry"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR "actorId" = current_setting('app.current_admin_id', true)
    OR "actorId" = current_setting('app.current_customer_id', true)
    OR (
      action = 'PLOT_BOOKED' 
      AND current_setting('app.can_view_sales_history', true) = 'true'
    )
  );

-- Ensure Booking and PaymentRecord do not have RLS enabled (Evaluate requirement)
-- Since parents are protected, these do not need RLS if only fetched via nested joins in Prisma.
-- But wait, `me.service.ts` fetches PaymentRecord directly: `this.prisma.paymentRecord.findMany`.
-- If we fetch it directly without RLS on PaymentRecord, `app_user` can read ALL PaymentRecords if they bypass `me.service.ts` filtering!
-- But since the application is the only thing querying `app_user` (and the app uses Prisma which filters `booking: { customerId }`), the data is safe AT THE APP LAYER.
-- RLS is defense in depth. Let's add RLS to PaymentRecord and Booking for completeness to be absolutely sure.
-- Actually, the user asked to EVALUATE if they need RLS enabled. If they are accessed directly, yes, they should.
-- Let's enable RLS on Booking and PaymentRecord and add self-access policies.

ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_block_scope ON "Booking";
CREATE POLICY booking_block_scope ON "Booking"
  FOR ALL
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR "customerId" = current_setting('app.current_customer_id', true)
    OR "plotId" IN (
      SELECT id FROM "Plot" WHERE "blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

ALTER TABLE "PaymentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_record_scope ON "PaymentRecord";
CREATE POLICY payment_record_scope ON "PaymentRecord"
  FOR ALL
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "bookingId" IN (
      SELECT id FROM "Booking" WHERE "customerId" = current_setting('app.current_customer_id', true)
    )
    OR "bookingId" IN (
      SELECT id FROM "Booking" WHERE "plotId" IN (
        SELECT id FROM "Plot" WHERE "blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
  );

-- 8. Reservation Policies with system_sweep
DROP POLICY IF EXISTS reservation_select_scope ON "Reservation";
CREATE POLICY reservation_select_scope ON "Reservation"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR "plotId" IN (
      SELECT id FROM "Plot" WHERE "blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

DROP POLICY IF EXISTS reservation_update_scope ON "Reservation";
CREATE POLICY reservation_update_scope ON "Reservation"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR "plotId" IN (
      SELECT id FROM "Plot" WHERE "blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

-- 9. ContentBlock Policies with system_sweep
ALTER TABLE "ContentBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentBlock" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_block_select_scope ON "ContentBlock";
CREATE POLICY content_block_select_scope ON "ContentBlock"
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS content_block_update_scope ON "ContentBlock";
CREATE POLICY content_block_update_scope ON "ContentBlock"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND (current_setting('app.current_permissions', true)::jsonb ? 'can_edit_content')
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND (current_setting('app.current_permissions', true)::jsonb ? 'can_edit_content')
    )
  );
