import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  initialBlocks,
  initialCustomers,
  initialAdminUsers,
  initialPlots,
  initialReservations,
  initialBookings,
  initialPayments,
  initialDocuments,
  initialContentBlocks
} from './data/seed';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log('Seeding database...');
  const adminHash  = await bcrypt.hash('admin123',  10);
  const memberHash = await bcrypt.hash('password123', 10);
  const defaultHash = adminHash; // kept for any other references below

  // 1. Create Blocks
  for (const block of initialBlocks) {
    await prisma.block.create({
      data: {
        id: block.id,
        name: block.name,
        description: block.description,
        totalPlots: block.totalPlots,
      }
    });
  }

  // 2. Create Admin Users
  for (const admin of initialAdminUsers) {
    const createdAdmin = await prisma.adminUser.create({
      data: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        fullName: admin.fullName,
        passwordHash: defaultHash,
        role: admin.role as any,
        status: admin.status,
        permissions: admin.permissions as any,
        createdDate: new Date(admin.createdDate || Date.now()),
      }
    });
    // Create assignments
    if (admin.assignedBlocks && admin.assignedBlocks.length > 0) {
      for (const blockId of admin.assignedBlocks) {
        await prisma.blockAssignment.create({
          data: {
            adminId: createdAdmin.id,
            blockId: blockId,
          }
        });
      }
    }
  }

  // 3. Create Customers
  for (const customer of initialCustomers) {
    await prisma.customer.create({
      data: {
        id: customer.id,
        membershipNo: customer.membershipNo || null,
        registrationStatus: customer.registrationStatus as any,
        fullName: customer.fullName,
        fatherOrHusbandName: customer.fatherOrHusbandName,
        cnic: customer.cnic,
        city: customer.city,
        email: customer.email,
        phone: customer.phone,
        mailingAddress: customer.mailingAddress,
        nokName: customer.nokName,
        nokCnic: customer.nokCnic,
        accountStatus: customer.accountStatus as any,
        passwordHash: customer.passwordHash ? memberHash : null,
        credentialsPending: customer.credentialsPending || false,
        termsAccepted: customer.termsAccepted || false,
        termsAcceptedAt: customer.termsAcceptedAt ? new Date(customer.termsAcceptedAt) : null,
        createdDate: new Date(customer.createdDate || Date.now()),
      }
    });
  }

  // 4. Create Plots
  for (const plot of initialPlots) {
    await prisma.plot.create({
      data: {
        id: plot.id,
        blockId: plot.blockId,
        plotNumber: plot.plotNumber,
        plotType: plot.plotType,
        category: plot.category as any,
        amenityName: plot.amenityName,
        size: plot.size,
        price: plot.price,
        status: plot.status as any,
        isAdjustment: plot.isAdjustment || false,
        adjustmentReason: plot.adjustmentReason,
        adjustmentDate: plot.adjustmentDate ? new Date(plot.adjustmentDate) : null,
        adjustmentBy: plot.adjustmentBy,
        currentOwnerId: plot.currentOwnerId,
        version: 0,
      }
    });
  }

  // 5. Create Bookings
  for (const booking of initialBookings) {
    await prisma.booking.create({
      data: {
        id: booking.id,
        customerId: booking.customerId,
        plotId: booking.plotId,
        paymentType: booking.paymentType as any,
        status: booking.status === 'completed' ? 'active' : booking.status,
        registrationStatus: booking.registrationStatus as any,
        bookingDate: booking.bookingDate ? new Date(booking.bookingDate) : new Date(),
        confirmationDate: booking.confirmationDate ? new Date(booking.confirmationDate) : null,
        createdByAdminId: 'admin-1', // Fallback for seed data
      }
    });
  }

  // 6. Create Payment Records
  for (const payment of initialPayments) {
    await prisma.paymentRecord.create({
      data: {
        id: payment.id,
        bookingId: payment.bookingId,
        feeType: payment.feeType as any,
        installmentNumber: payment.installmentNumber,
        dueDate: payment.dueDate ? new Date(payment.dueDate) : null,
        amount: payment.amount,
        paidAmount: payment.paidAmount || 0,
        status: payment.status as any,
      }
    });
  }

  // 7. Create Documents (System Generated & Customer Uploaded)
  const systemDocTypes = ['booking_confirmation', 'payment_receipt', 'booking_agreement', 'installment_schedule'];
  for (const doc of initialDocuments) {
    const booking = initialBookings.find(b => b.id === doc.bookingId);
    if (!booking) continue; // safety check
    if (systemDocTypes.includes(doc.type)) {
      await prisma.societyDocument.create({
        data: {
          id: doc.id,
          customerId: booking.customerId,
          bookingId: doc.bookingId,
          type: doc.type as any,
          fileName: doc.fileName,
          fileUrl: doc.mockFileUrl || '',
          fileSizeKb: doc.fileSizeKb,
          uploadedAt: doc.uploadDate ? new Date(doc.uploadDate) : new Date(),
        }
      });
    } else {
      await prisma.customerDocument.create({
        data: {
          id: doc.id,
          customerId: booking.customerId,
          bookingId: doc.bookingId,
          type: doc.type as any,
          fileName: doc.fileName,
          fileUrl: doc.mockFileUrl || '',
          fileSizeKb: doc.fileSizeKb,
          uploadedAt: doc.uploadDate ? new Date(doc.uploadDate) : new Date(),
          uploadedById: 'admin-1',
        }
      });
    }
  }

  // 8. Create Content Blocks
  for (const block of initialContentBlocks) {
    await prisma.contentBlock.create({
      data: {
        id: block.id,
        section: block.section as any,
        title: block.title,
        subtitle: block.subtitle,
        content: block.content,
        metadata: block.metadata as any || {},
      }
    });
  }

  console.log('Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
