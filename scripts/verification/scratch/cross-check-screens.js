const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log('=== DIRECT DATABASE CROSS-CHECK FOR ALL PHASE 1 SCREENS ===\n');

  // Screen 1: Admin Login / Dashboard Scope
  const marketingAdmin = await prisma.adminUser.findUnique({
    where: { username: 'marketing' },
    include: { assignments: true },
  });
  console.log('1. Admin: marketing');
  console.log('   Full Name:', marketingAdmin.fullName);
  console.log('   Role:', marketingAdmin.role);
  console.log('   Assigned Blocks:', marketingAdmin.assignments.map(a => a.blockId).join(', '));

  // Screen 2: Level 1 Master Plan (/admin/master-plan)
  console.log('\n2. Master Plan Level 1 (/admin/master-plan):');
  for (const blockId of ['abbott', 'royal']) {
    const block = await prisma.block.findUnique({
      where: { id: blockId },
      include: { plots: true },
    });
    const sellable = block.plots.filter(p => p.category !== 'amenity');
    const available = sellable.filter(p => p.status === 'available').length;
    const reserved = sellable.filter(p => p.status === 'reserved').length;
    const booked = sellable.filter(p => p.status === 'booked').length;
    const amenity = block.plots.filter(p => p.category === 'amenity').length;
    const disputed = block.plots.filter(p => p.isAdjustment).length;
    console.log(`   Block [${blockId.toUpperCase()}]:`);
    console.log(`     Total Seeded Sellable: ${sellable.length}`);
    console.log(`     Available: ${available}`);
    console.log(`     Reserved: ${reserved}`);
    console.log(`     Booked: ${booked}`);
    console.log(`     Amenity: ${amenity}`);
    console.log(`     Disputed / Adjustment: ${disputed}`);
  }

  // Screen 3: Level 2 Plot Grid (/admin/master-plan/abbott)
  console.log('\n3. Level 2 Plot Grid for Abbott (/admin/master-plan/abbott):');
  const abbottPlots = await prisma.plot.findMany({
    where: { blockId: 'abbott' },
    orderBy: { plotNumber: 'asc' },
  });
  console.log(`   Total Plots in Grid: ${abbottPlots.length}`);
  abbottPlots.forEach(p => {
    console.log(`     Plot ${p.plotNumber} (${p.id}): Category=${p.category}, Size=${p.size}, Price=PKR ${Number(p.price).toLocaleString()}, Status=${p.status}, isAdjustment=${p.isAdjustment}`);
  });

  // Screen 4: Single Plot Details (Plot A-01)
  console.log('\n4. Single Plot Modal Details for Plot A-01:');
  const plotA01 = await prisma.plot.findUnique({
    where: { id: 'plot-a-01' },
    include: { block: true },
  });
  console.log(`   ID: ${plotA01.id}, PlotNumber: ${plotA01.plotNumber}, Block: ${plotA01.block.name}`);
  console.log(`   Size: ${plotA01.size}, Price: PKR ${Number(plotA01.price).toLocaleString()}, Status: ${plotA01.status}`);

  // Screen 5: Customers Directory (/admin/customers-directory)
  console.log('\n5. Customers Directory (/admin/customers-directory):');
  const customers = await prisma.customer.findMany({
    orderBy: { id: 'asc' },
    include: { bookings: { include: { plot: true } } },
  });
  console.log(`   Total Customers: ${customers.length}`);
  customers.forEach(c => {
    const ownedPlots = c.bookings.map(b => b.plot.plotNumber).join(', ');
    console.log(`     Customer [${c.id}] ${c.fullName}: CNIC=${c.cnic}, Status=${c.accountStatus}, Member#=${c.membershipNo || 'None'}, BookedPlots=[${ownedPlots}]`);
  });

  // Screen 6 & 7: Member Portal Dashboard (/society-members/dashboard) for Tariq Mehmood (PV-2024-001)
  console.log('\n6 & 7. Member Portal Dashboard for Tariq Mehmood (cust-1 / PV-2024-001):');
  const tariq = await prisma.customer.findUnique({
    where: { id: 'cust-1' },
    include: {
      bookings: {
        include: {
          plot: true,
          payments: true,
        },
      },
    },
  });
  console.log(`   Member: ${tariq.fullName} (${tariq.membershipNo})`);
  console.log(`   Bookings count: ${tariq.bookings.length}`);
  for (const b of tariq.bookings) {
    console.log(`     Booking ${b.id}: Plot=${b.plot.plotNumber}, Status=${b.status}`);
    const paidSum = b.payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.paidAmount || p.amount), 0);
    const totalDue = b.payments.reduce((s, p) => s + Number(p.amount), 0);
    console.log(`       Payments: ${b.payments.length} records, Paid: PKR ${paidSum.toLocaleString()}, Total Due: PKR ${totalDue.toLocaleString()}`);
  }

  // Screen 8: Member Payments Ledger (/society-members/payments)
  console.log('\n8. Payments for Tariq Mehmood:');
  const tariqPayments = await prisma.paymentRecord.findMany({
    where: {
      booking: { customerId: 'cust-1' },
    },
    orderBy: { dueDate: 'asc' },
  });
  console.log(`   Total Payment Records: ${tariqPayments.length}`);
  tariqPayments.forEach(p => {
    console.log(`     ${p.id}: FeeType=${p.feeType}, DueDate=${p.dueDate.toISOString().slice(0, 10)}, Amount=PKR ${Number(p.amount).toLocaleString()}, Status=${p.status}`);
  });
}


main().catch(console.error).finally(() => prisma.$disconnect());
