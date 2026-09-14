-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 RLS Policies & Privilege Escalation Guards
-- Tables: AdminUser, ContentBlock, ReceiptSubmission, CustomerStrike,
--         SocietyDocument, CustomerDocument
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Table-level grants to app_user
GRANT SELECT, INSERT, UPDATE, DELETE ON "AdminUser" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ContentBlock" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ReceiptSubmission" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomerStrike" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SocietyDocument" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomerDocument" TO app_user;

-- 2. Enable & Force Row-Level Security
ALTER TABLE "AdminUser"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentBlock"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerStrike"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SocietyDocument"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerDocument"  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AdminUser"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "ContentBlock"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptSubmission" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CustomerStrike"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "SocietyDocument"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "CustomerDocument"  FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- Table 1: AdminUser
-- ─────────────────────────────────────────────────────────────────────────

-- Trigger function guarding against column-level privilege escalation (no SECURITY DEFINER)
CREATE OR REPLACE FUNCTION guard_admin_user_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.current_role', true) IS DISTINCT FROM 'super_admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Privilege escalation rejected: non-super-admin cannot alter role'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.permissions::text IS DISTINCT FROM OLD.permissions::text THEN
      RAISE EXCEPTION 'Privilege escalation rejected: non-super-admin cannot alter permissions'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Privilege escalation rejected: non-super-admin cannot alter status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_admin_user_escalation ON "AdminUser";
CREATE TRIGGER trg_guard_admin_user_escalation
  BEFORE UPDATE ON "AdminUser"
  FOR EACH ROW
  EXECUTE FUNCTION guard_admin_user_escalation();

DROP POLICY IF EXISTS admin_user_select_scope ON "AdminUser";
CREATE POLICY admin_user_select_scope ON "AdminUser"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_admin_id', true)
  );

DROP POLICY IF EXISTS admin_user_insert_scope ON "AdminUser";
CREATE POLICY admin_user_insert_scope ON "AdminUser"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
  );

DROP POLICY IF EXISTS admin_user_update_scope ON "AdminUser";
CREATE POLICY admin_user_update_scope ON "AdminUser"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_admin_id', true)
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_admin_id', true)
  );

DROP POLICY IF EXISTS admin_user_delete_scope ON "AdminUser";
CREATE POLICY admin_user_delete_scope ON "AdminUser"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Table 2: ContentBlock
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS content_block_select_scope ON "ContentBlock";
CREATE POLICY content_block_select_scope ON "ContentBlock"
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS content_block_insert_scope ON "ContentBlock";
CREATE POLICY content_block_insert_scope ON "ContentBlock"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
  );

DROP POLICY IF EXISTS content_block_update_scope ON "ContentBlock";
CREATE POLICY content_block_update_scope ON "ContentBlock"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND current_setting('app.current_permissions', true)::jsonb ? 'can_edit_content'
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND current_setting('app.current_permissions', true)::jsonb ? 'can_edit_content'
    )
  );

DROP POLICY IF EXISTS content_block_delete_scope ON "ContentBlock";
CREATE POLICY content_block_delete_scope ON "ContentBlock"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Table 3: ReceiptSubmission
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS receipt_submission_select_scope ON "ReceiptSubmission";
CREATE POLICY receipt_submission_select_scope ON "ReceiptSubmission"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "customerId" = current_setting('app.current_customer_id', true)
    OR "bookingId" IN (
      SELECT b.id FROM "Booking" b
      JOIN "Plot" p ON p.id = b."plotId"
      WHERE p."blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

DROP POLICY IF EXISTS receipt_submission_insert_scope ON "ReceiptSubmission";
CREATE POLICY receipt_submission_insert_scope ON "ReceiptSubmission"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR "customerId" = current_setting('app.current_customer_id', true)
  );

DROP POLICY IF EXISTS receipt_submission_update_scope ON "ReceiptSubmission";
CREATE POLICY receipt_submission_update_scope ON "ReceiptSubmission"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND current_setting('app.current_permissions', true)::jsonb ? 'can_verify_receipts'
      AND "bookingId" IN (
        SELECT b.id FROM "Booking" b
        JOIN "Plot" p ON p.id = b."plotId"
        WHERE p."blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
  );

DROP POLICY IF EXISTS receipt_submission_delete_scope ON "ReceiptSubmission";
CREATE POLICY receipt_submission_delete_scope ON "ReceiptSubmission"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Table 4: CustomerStrike
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS customer_strike_select_scope ON "CustomerStrike";
CREATE POLICY customer_strike_select_scope ON "CustomerStrike"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "customerId" = current_setting('app.current_customer_id', true)
    OR "customerId" IN (
      SELECT b."customerId" FROM "Booking" b
      JOIN "Plot" p ON p.id = b."plotId"
      WHERE p."blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

DROP POLICY IF EXISTS customer_strike_insert_scope ON "CustomerStrike";
CREATE POLICY customer_strike_insert_scope ON "CustomerStrike"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND (
        current_setting('app.current_permissions', true)::jsonb ? 'can_verify_receipts'
        OR current_setting('app.current_permissions', true)::jsonb ? 'can_view_customers'
      )
    )
  );

DROP POLICY IF EXISTS customer_strike_delete_scope ON "CustomerStrike";
CREATE POLICY customer_strike_delete_scope ON "CustomerStrike"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Table 5: SocietyDocument
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS society_document_select_scope ON "SocietyDocument";
CREATE POLICY society_document_select_scope ON "SocietyDocument"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "customerId" = current_setting('app.current_customer_id', true)
    OR "bookingId" IN (
      SELECT b.id FROM "Booking" b
      JOIN "Plot" p ON p.id = b."plotId"
      WHERE p."blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

DROP POLICY IF EXISTS society_document_insert_scope ON "SocietyDocument";
CREATE POLICY society_document_insert_scope ON "SocietyDocument"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) IN ('super_admin', 'sub_admin')
  );

DROP POLICY IF EXISTS society_document_delete_scope ON "SocietyDocument";
CREATE POLICY society_document_delete_scope ON "SocietyDocument"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Table 6: CustomerDocument
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS customer_document_select_scope ON "CustomerDocument";
CREATE POLICY customer_document_select_scope ON "CustomerDocument"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR "customerId" = current_setting('app.current_customer_id', true)
    OR "customerId" IN (
      SELECT b."customerId" FROM "Booking" b
      JOIN "Plot" p ON p.id = b."plotId"
      WHERE p."blockId" IN (
        SELECT "blockId" FROM "BlockAssignment"
        WHERE "adminId" = current_setting('app.current_admin_id', true)
      )
    )
  );

DROP POLICY IF EXISTS customer_document_insert_scope ON "CustomerDocument";
CREATE POLICY customer_document_insert_scope ON "CustomerDocument"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) IN ('super_admin', 'sub_admin')
  );

DROP POLICY IF EXISTS customer_document_delete_scope ON "CustomerDocument";
CREATE POLICY customer_document_delete_scope ON "CustomerDocument"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
  );

