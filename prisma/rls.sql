-- ─────────────────────────────────────────────────────────────────────────
-- Step 1: Create application database role with minimal grants
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN;
  END IF;
END
$$;
GRANT CONNECT ON DATABASE postgres TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 2: Enable Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Plot"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEntry"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Plot"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "Reservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Customer"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditEntry"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "Booking"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord" FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 3: RLS Policies
-- ─────────────────────────────────────────────────────────────────────────

-- Plot Policies
DROP POLICY IF EXISTS plot_block_scope ON "Plot";
CREATE POLICY plot_block_scope ON "Plot"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "currentOwnerId" = current_setting('app.current_customer_id', true)
    OR "blockId" IN (
      SELECT "blockId" FROM "BlockAssignment"
      WHERE "adminId" = current_setting('app.current_admin_id', true)
    )
  );

DROP POLICY IF EXISTS plot_update_scope ON "Plot";
CREATE POLICY plot_update_scope ON "Plot"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "blockId" IN (
      SELECT "blockId" FROM "BlockAssignment"
      WHERE "adminId" = current_setting('app.current_admin_id', true)
    )
  );

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

-- Reservation Policies
DROP POLICY IF EXISTS reservation_select_scope ON "Reservation";
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

DROP POLICY IF EXISTS reservation_update_scope ON "Reservation";
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

DROP POLICY IF EXISTS reservation_delete_scope ON "Reservation";
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

DROP POLICY IF EXISTS reservation_insert_scope ON "Reservation";
CREATE POLICY reservation_insert_scope ON "Reservation"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.can_reserve', true) = 'true'
  );

-- Customer Policies
DROP POLICY IF EXISTS customer_block_scope ON "Customer";
CREATE POLICY customer_block_scope ON "Customer"
  FOR SELECT
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

DROP POLICY IF EXISTS customer_insert_scope ON "Customer";
CREATE POLICY customer_insert_scope ON "Customer"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.can_create_customer', true) = 'true'
  );

-- Booking Policies
DROP POLICY IF EXISTS booking_select_scope ON "Booking";
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

DROP POLICY IF EXISTS booking_update_scope ON "Booking";
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

DROP POLICY IF EXISTS booking_delete_scope ON "Booking";
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

DROP POLICY IF EXISTS booking_insert_scope ON "Booking";
CREATE POLICY booking_insert_scope ON "Booking"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.can_book', true) = 'true'
  );

-- PaymentRecord Policies
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

-- ─────────────────────────────────────────────────────────────────────────
-- Step 4: AuditEntry
-- ─────────────────────────────────────────────────────────────────────────
REVOKE UPDATE, DELETE ON "AuditEntry" FROM app_user;

DROP POLICY IF EXISTS audit_entry_insert_scope ON "AuditEntry";
CREATE POLICY audit_entry_insert_scope ON "AuditEntry"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) IN ('super_admin', 'sub_admin', 'customer')
  );

DROP POLICY IF EXISTS audit_entry_select_scope ON "AuditEntry";
CREATE POLICY audit_entry_select_scope ON "AuditEntry"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
  );
