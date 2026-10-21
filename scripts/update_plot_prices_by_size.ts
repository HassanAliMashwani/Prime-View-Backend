import 'dotenv/config';
import { PrismaService, ScopedSession } from '../src/prisma/prisma.service';
import { generateFixedSchedule } from '../src/common/schedule-calculator';
import { FeeType, PaymentStatus } from '@prisma/client';

const TARGET_PRICES: Record<string, number> = {
  '5 Marla': 2500000,
  '7.5 Marla': 3600000,
  '10 Marla': 4900000,
  '13 Marla': 6400000,
  '1 Kanal': 10000000,
  '2 Kanal': 30000000,
};

async function main() {
  const prisma = new PrismaService({
    datasources: {
      db: {
        url: process.env.DIRECT_URL || process.env.DATABASE_URL,
      },
    },
  });

  const session: ScopedSession = {
    role: 'super_admin',
    adminId: 'system_pricing_update',
    permissions: {
      can_book: true,
      can_reserve: true,
      can_create_customer: true,
      can_view_sales_history: true,
    },
  };

  try {
    const totalPlotsBefore = await prisma.plot.count();
    console.log(`Starting update. Total plots in DB: ${totalPlotsBefore}`);
    if (totalPlotsBefore !== 1673) {
      throw new Error(`Expected exactly 1673 plots, found ${totalPlotsBefore}. Aborting.`);
    }

    const result = await prisma.withScopedSession(session, async (tx) => {
      // 1. Fetch all plots before update to track changes
      const allPlots = await tx.plot.findMany({
        select: {
          id: true,
          plotNumber: true,
          blockId: true,
          size: true,
          price: true,
          status: true,
        },
      });

      const changedCountsBySize: Record<string, number> = {
        '5 Marla': 0,
        '7.5 Marla': 0,
        '10 Marla': 0,
        '13 Marla': 0,
        '1 Kanal': 0,
        '2 Kanal': 0,
      };

      const totalTargetPlotsBySize: Record<string, number> = {
        '5 Marla': 0,
        '7.5 Marla': 0,
        '10 Marla': 0,
        '13 Marla': 0,
        '1 Kanal': 0,
        '2 Kanal': 0,
      };

      let unchangedCount = 0;

      for (const p of allPlots) {
        const targetPrice = TARGET_PRICES[p.size];
        if (targetPrice !== undefined) {
          totalTargetPlotsBySize[p.size]++;
          const oldPrice = Number(p.price);
          if (oldPrice !== targetPrice) {
            changedCountsBySize[p.size]++;
          }
        } else {
          unchangedCount++;
        }
      }

      // 2. Perform plot price updates for each of the six target sizes
      for (const [size, newPrice] of Object.entries(TARGET_PRICES)) {
        const updateRes = await tx.plot.updateMany({
          where: { size },
          data: { price: newPrice },
        });
        console.log(`Updated plot.price for size "${size}" to ${newPrice.toLocaleString()} PKR. Rows updated: ${updateRes.count}`);
      }

      // 3. Handle booked plots with installment schedules
      const bookedPlotsWithSchedules = await tx.booking.findMany({
        where: {
          plot: {
            size: { in: Object.keys(TARGET_PRICES) },
          },
        },
        include: {
          plot: true,
          payments: true,
        },
      });

      console.log(`\nEvaluating ${bookedPlotsWithSchedules.length} booking(s) on target size plots for schedule updates...`);
      let rebuiltSchedulesCount = 0;
      let preservedPaidSchedulesCount = 0;

      for (const b of bookedPlotsWithSchedules) {
        if (!b.installmentPlan && b.payments.length === 0) {
          continue; // Quick booking without schedule established yet
        }

        const plotPayments = b.payments.filter((pay) =>
          ['plot_installment', 'plot_downpayment', 'plot_one_time', 'plot_biannual', 'plot_possession'].includes(pay.feeType)
        );
        const hasPaidPlotMoney = plotPayments.some((pay) => Number(pay.paidAmount) > 0 || pay.status === PaymentStatus.paid);

        const newPlotPrice = TARGET_PRICES[b.plot.size];

        if (hasPaidPlotMoney) {
          console.log(
            `Booking ${b.id} (Plot ${b.plot.blockId}-${b.plot.plotNumber}, size "${b.plot.size}"): has paid plot bills. Keeping all PaymentRecord rows intact.`
          );
          preservedPaidSchedulesCount++;
        } else if (b.installmentPlan) {
          console.log(
            `Booking ${b.id} (Plot ${b.plot.blockId}-${b.plot.plotNumber}, size "${b.plot.size}"): has unpaid installment schedule. Rebuilding schedule with new price ${newPlotPrice.toLocaleString()} PKR.`
          );

          // Rebuild unpaid schedule
          const rawPlan = b.installmentPlan as any;
          const planYears = Number(rawPlan?.planYears || rawPlan?.years || 1);
          const bookingDate = b.bookingDate || new Date();

          const schedule = generateFixedSchedule({
            plotPriceRupees: newPlotPrice,
            planYears,
            bookingDate,
          });

          // Delete only unpaid plot bills
          await tx.paymentRecord.deleteMany({
            where: {
              bookingId: b.id,
              feeType: {
                in: [
                  FeeType.plot_installment,
                  FeeType.plot_downpayment,
                  FeeType.plot_one_time,
                  FeeType.plot_biannual,
                  FeeType.plot_possession,
                ],
              },
              paidAmount: 0,
              status: { not: PaymentStatus.paid },
            },
          });

          const billsToCreate = schedule.map((item, i) => ({
            id: `pay-${item.feeType}-${b.id}-${item.installmentNumber ?? i}-${Date.now()}-${i}`,
            bookingId: b.id,
            feeType: item.feeType,
            installmentNumber: item.installmentNumber,
            dueDate: item.dueDate,
            amount: item.amount,
            paidAmount: item.paidAmount,
            status: item.status,
          }));

          await tx.paymentRecord.createMany({ data: billsToCreate });

          const totalRows = planYears * 12;
          const biannualCount = planYears * 2;
          const monthlyCount = totalRows - 1 - biannualCount - 1;

          const updatedInstallmentPlan = {
            ...rawPlan,
            planYears,
            totalPayment: newPlotPrice,
            downpayment: schedule[0].amount,
            monthlyInstallmentCount: monthlyCount,
            biannualInstallmentCount: biannualCount,
            numberOfInstallments: monthlyCount + biannualCount,
          };

          await tx.booking.update({
            where: { id: b.id },
            data: { installmentPlan: updatedInstallmentPlan },
          });

          rebuiltSchedulesCount++;
        }
      }

      console.log(`Rebuilt schedules: ${rebuiltSchedulesCount}, Preserved paid schedules: ${preservedPaidSchedulesCount}`);

      return {
        changedCountsBySize,
        totalTargetPlotsBySize,
        unchangedCount,
      };
    });

    // 4. Verification queries after the transaction commits
    const totalPlotsAfter = await prisma.plot.count();
    console.log(`\n========================================`);
    console.log(`VERIFICATION AFTER UPDATE`);
    console.log(`Total plots in DB: ${totalPlotsAfter}`);

    if (totalPlotsAfter !== 1673) {
      throw new Error(`Plot count changed! Expected 1673, found ${totalPlotsAfter}`);
    }

    console.log('\nPlots changed for each of the six sizes:');
    let totalTargetPlots = 0;
    let totalActuallyChangedPrice = 0;
    for (const [size, count] of Object.entries(result.totalTargetPlotsBySize)) {
      const changedVal = result.changedCountsBySize[size];
      console.log(`  - ${size}: ${count} plots set to ${TARGET_PRICES[size].toLocaleString()} PKR (${changedVal} had their price value updated)`);
      totalTargetPlots += count;
      totalActuallyChangedPrice += changedVal;
    }

    console.log(`\nPlots left unchanged (other sizes, commercial, amenities, blank): ${result.unchangedCount}`);
    console.log(`Total Target Plots + Unchanged: ${totalTargetPlots} + ${result.unchangedCount} = ${totalTargetPlots + result.unchangedCount}`);

    // Check sizes distribution still exact
    const checkPlots = await prisma.plot.groupBy({
      by: ['size'],
      _count: { id: true },
    });
    const totalGrouped = checkPlots.reduce((sum, g) => sum + g._count.id, 0);
    console.log(`Grouped sum of all plot sizes: ${totalGrouped} (must be 1673)`);
    console.log(`========================================\n`);

  } catch (err) {
    console.error('Update failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
