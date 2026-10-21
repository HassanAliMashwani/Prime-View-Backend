const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const customers = await prisma.customer.findMany({
    where: { registrationStatus: 'minimal' },
    include: {
      bookings: {
        include: {
          plot: true
        }
      }
    }
  });
  console.log('Minimal customers:', JSON.stringify(customers, null, 2));
}
run().finally(() => prisma.$disconnect());
