import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });

async function main() {
  console.log('Applying updated customer_insert_scope and customer_update_scope policies...');
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS customer_insert_scope ON "Customer"`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY customer_insert_scope ON "Customer"
      FOR INSERT
      WITH CHECK (
        current_setting('app.current_role', true) = 'super_admin'
        OR current_setting('app.can_create_customer', true) = 'true'
        OR current_setting('app.can_book', true) = 'true'
      )
  `);

  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS customer_update_scope ON "Customer"`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY customer_update_scope ON "Customer"
      FOR UPDATE
      USING (
        current_setting('app.current_role', true) = 'super_admin'
        OR id = current_setting('app.current_customer_id', true)
        OR current_setting('app.current_role', true) = ''
        OR current_setting('app.can_create_customer', true) = 'true'
        OR current_setting('app.can_book', true) = 'true'
        OR id IN (
          SELECT "customerId" FROM "Booking" WHERE "plotId" IN (
            SELECT id FROM "Plot" WHERE "blockId" IN (
              SELECT "blockId" FROM "BlockAssignment"
              WHERE "adminId" = current_setting('app.current_admin_id', true)
            )
          )
        )
      )
  `);
  console.log('Successfully updated RLS policies on Customer!');
}

main().finally(() => prisma.$disconnect());
