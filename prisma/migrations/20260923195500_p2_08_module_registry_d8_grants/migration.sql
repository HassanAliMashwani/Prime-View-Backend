-- Set app.current_role to super_admin so guard_admin_user_escalation() trigger permits backfill
SELECT set_config('app.current_role', 'super_admin', true);

-- D8 Backfill: for every new registry key, for every AdminUser whose role is sub_admin:
-- if the key is absent from permissions JSON, set it true. Do not flip an existing false to true.
UPDATE "AdminUser"
SET permissions = jsonb_build_object(
  'can_view_inventory', true,
  'can_view_master_plan', true
)::jsonb || COALESCE(permissions::jsonb, '{}'::jsonb)
WHERE role = 'sub_admin';

-- AdminUser Policies (allow bare Prisma / login lookup)
DROP POLICY IF EXISTS admin_user_select_scope ON "AdminUser";
CREATE POLICY admin_user_select_scope ON "AdminUser"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_admin_id', true)
    OR current_setting('app.current_role', true) = ''
  );

DROP POLICY IF EXISTS admin_user_update_scope ON "AdminUser";
CREATE POLICY admin_user_update_scope ON "AdminUser"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_admin_id', true)
    OR current_setting('app.current_role', true) = ''
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_admin_id', true)
    OR current_setting('app.current_role', true) = ''
  );

-- Customer Policies (allow bare Prisma / member login and customer self-update for accept-terms)
DROP POLICY IF EXISTS customer_block_scope ON "Customer";
CREATE POLICY customer_block_scope ON "Customer"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_customer_id', true)
    OR current_setting('app.current_role', true) = ''
    OR (
      NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."customerId" = "Customer".id)
      AND (current_setting('app.can_create_customer', true) = 'true' OR current_setting('app.can_book', true) = 'true')
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

DROP POLICY IF EXISTS customer_update_scope ON "Customer";
CREATE POLICY customer_update_scope ON "Customer"
  FOR UPDATE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR id = current_setting('app.current_customer_id', true)
    OR current_setting('app.current_role', true) = ''
    OR id IN (
      SELECT "customerId" FROM "Booking" WHERE "plotId" IN (
        SELECT id FROM "Plot" WHERE "blockId" IN (
          SELECT "blockId" FROM "BlockAssignment"
          WHERE "adminId" = current_setting('app.current_admin_id', true)
        )
      )
    )
  );

-- ContentBlock Policies (allow sub_admin with can_edit_content to insert/delete)
DROP POLICY IF EXISTS content_block_insert_scope ON "ContentBlock";
CREATE POLICY content_block_insert_scope ON "ContentBlock"
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_role', true) = 'super_admin'
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND (current_setting('app.current_permissions', true)::jsonb ? 'can_edit_content')
    )
  );

DROP POLICY IF EXISTS content_block_delete_scope ON "ContentBlock";
CREATE POLICY content_block_delete_scope ON "ContentBlock"
  FOR DELETE
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR (
      current_setting('app.current_role', true) = 'sub_admin'
      AND (current_setting('app.current_permissions', true)::jsonb ? 'can_edit_content')
    )
  );

-- ReceiptSubmission Policies (allow public verify slip lookup)
DROP POLICY IF EXISTS receipt_submission_select_scope ON "ReceiptSubmission";
CREATE POLICY receipt_submission_select_scope ON "ReceiptSubmission"
  FOR SELECT
  USING (
    current_setting('app.current_role', true) = 'super_admin'
    OR current_setting('app.current_role', true) = ''
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
