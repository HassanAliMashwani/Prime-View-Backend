const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const plotsWithBookings = await prisma.plot.findMany({
    where: { status: 'booked' },
    include: {
      bookings: {
        include: {
          customer: true
        }
      }
    }
  });
  console.log('Booked plots count:', plotsWithBookings.length);
  for (const p of plotsWithBookings) {
    for (const b of p.bookings) {
      console.log(`Plot ${p.plotNumber} (${p.blockId}) -> Customer: ${b.customer.fullName} (${b.customer.id}, status: ${b.customer.registrationStatus}) bookedBy: ${b.bookedByAdminId}`);
    }
  }
}
run().finally(() => prisma.$disconnect());
