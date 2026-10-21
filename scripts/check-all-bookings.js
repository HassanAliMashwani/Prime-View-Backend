const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
async function run() {
  const allBookings = await prisma.booking.findMany({
    include: {
      customer: true,
      plot: true
    }
  });
  console.log('Total bookings:', allBookings.length);
  for (const b of allBookings) {
    console.log(`Booking: ${b.id}, plot: ${b.plot?.plotNumber} (${b.plot?.blockId}), customer: ${b.customer?.fullName} (${b.customer?.registrationStatus}), status: ${b.status}`);
  }
}
run().finally(() => prisma.$disconnect());
