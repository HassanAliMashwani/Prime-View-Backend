require('dotenv').config();
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } }
  });
  
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS plot_status_history_select ON "PlotStatusHistory";`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY plot_status_history_select ON "PlotStatusHistory"
      FOR SELECT
      USING (
        current_setting('app.current_role', true) = 'super_admin' OR
        (
          current_setting('app.current_role', true) = 'sub_admin' AND
          EXISTS (
            SELECT 1 FROM "Plot" 
            WHERE id = "plotId" AND "blockId" IN (
              SELECT "blockId" FROM "BlockAssignment" WHERE "adminId" = current_setting('app.current_user_id', true)
            )
          )
        ) OR
        current_setting('app.current_session_id', true) = 'system_sweep'
      );
  `);
  
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS plot_status_history_insert ON "PlotStatusHistory";`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY plot_status_history_insert ON "PlotStatusHistory"
      FOR INSERT
      WITH CHECK (
        current_setting('app.current_role', true) = 'super_admin' OR
        (
          current_setting('app.current_role', true) = 'sub_admin' AND
          EXISTS (
            SELECT 1 FROM "Plot" 
            WHERE id = "plotId" AND "blockId" IN (
              SELECT "blockId" FROM "BlockAssignment" WHERE "adminId" = current_setting('app.current_user_id', true)
            )
          )
        ) OR
        current_setting('app.current_session_id', true) = 'system_sweep'
      );
  `);
  
  console.log('Applied PlotStatusHistory RLS successfully!');
}

main().catch(console.error).finally(() => process.exit(0));
