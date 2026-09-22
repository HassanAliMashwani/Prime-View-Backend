-- RLS update for P2-02: allow dedicated system_sweep daemon session
-- Grants system_sweep daemon access to Plot, Reservation, Booking, AuditEntry, and ContentBlock

-- 1. Plot
DROP POLICY IF EXISTS plot_block_scope ON "Plot";
CREATE POLICY plot_block_scope ON "Plot"
FOR SELECT USING (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ("currentOwnerId" = current_setting('app.current_customer_id', true)) OR
  ("blockId" IN (
    SELECT "BlockAssignment"."blockId"
    FROM "BlockAssignment"
    WHERE "BlockAssignment"."adminId" = current_setting('app.current_admin_id', true)
  ))
);

DROP POLICY IF EXISTS plot_update_scope ON "Plot";
CREATE POLICY plot_update_scope ON "Plot"
FOR UPDATE USING (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ("blockId" IN (
    SELECT "BlockAssignment"."blockId"
    FROM "BlockAssignment"
    WHERE "BlockAssignment"."adminId" = current_setting('app.current_admin_id', true)
  ))
);

-- 2. Reservation
DROP POLICY IF EXISTS reservation_select_scope ON "Reservation";
CREATE POLICY reservation_select_scope ON "Reservation"
FOR SELECT USING (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ("plotId" IN (
    SELECT "Plot".id
    FROM "Plot"
    WHERE ("Plot"."blockId" IN (
      SELECT "BlockAssignment"."blockId"
      FROM "BlockAssignment"
      WHERE "BlockAssignment"."adminId" = current_setting('app.current_admin_id', true)
    ))
  ))
);

DROP POLICY IF EXISTS reservation_update_scope ON "Reservation";
CREATE POLICY reservation_update_scope ON "Reservation"
FOR UPDATE USING (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ("plotId" IN (
    SELECT "Plot".id
    FROM "Plot"
    WHERE ("Plot"."blockId" IN (
      SELECT "BlockAssignment"."blockId"
      FROM "BlockAssignment"
      WHERE "BlockAssignment"."adminId" = current_setting('app.current_admin_id', true)
    ))
  ))
);

-- 3. Booking
DROP POLICY IF EXISTS booking_select_scope ON "Booking";
CREATE POLICY booking_select_scope ON "Booking"
FOR SELECT USING (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ("customerId" = current_setting('app.current_customer_id', true)) OR
  ("plotId" IN (
    SELECT "Plot".id
    FROM "Plot"
    WHERE ("Plot"."blockId" IN (
      SELECT "BlockAssignment"."blockId"
      FROM "BlockAssignment"
      WHERE "BlockAssignment"."adminId" = current_setting('app.current_admin_id', true)
    ))
  ))
);

-- 4. AuditEntry
DROP POLICY IF EXISTS audit_entry_insert_scope ON "AuditEntry";
CREATE POLICY audit_entry_insert_scope ON "AuditEntry"
FOR INSERT WITH CHECK (
  current_setting('app.current_role', true) = ANY (ARRAY['super_admin', 'sub_admin', 'customer', 'system_sweep'])
);

DROP POLICY IF EXISTS audit_entry_select_scope ON "AuditEntry";
CREATE POLICY audit_entry_select_scope ON "AuditEntry"
FOR SELECT USING (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ("actorId" = current_setting('app.current_admin_id', true)) OR
  ("actorId" = current_setting('app.current_customer_id', true)) OR
  ((action = 'PLOT_BOOKED') AND (current_setting('app.can_view_sales_history', true) = 'true'))
);

-- 5. ContentBlock
DROP POLICY IF EXISTS content_block_update_scope ON "ContentBlock";
CREATE POLICY content_block_update_scope ON "ContentBlock"
FOR UPDATE USING (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ((current_setting('app.current_role', true) = 'sub_admin') AND ((current_setting('app.current_permissions', true))::jsonb ? 'can_edit_content'))
) WITH CHECK (
  (current_setting('app.current_role', true) IN ('super_admin', 'system_sweep')) OR
  ((current_setting('app.current_role', true) = 'sub_admin') AND ((current_setting('app.current_permissions', true))::jsonb ? 'can_edit_content'))
);
