-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'sub_admin');

-- CreateEnum
CREATE TYPE "PlotCategory" AS ENUM ('residential', 'commercial', 'farm_house', 'amenity');

-- CreateEnum
CREATE TYPE "PlotStatus" AS ENUM ('available', 'reserved', 'booked');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('active', 'confirmed', 'superseded', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('installment', 'one_time');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('admission_fee', 'share_subscription_fee', 'plot_downpayment', 'plot_installment', 'plot_one_time');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'overdue');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'pending');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('minimal', 'complete');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('applicant_photo', 'cnic_copy', 'nok_cnic_copy', 'other');

-- CreateEnum
CREATE TYPE "GeneratedDocType" AS ENUM ('booking_confirmation', 'payment_receipt', 'booking_agreement', 'installment_schedule');

-- CreateEnum
CREATE TYPE "ContentSection" AS ENUM ('plans', 'events');

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalPlots" INTEGER,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plot" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "plotNumber" TEXT NOT NULL,
    "plotType" TEXT NOT NULL,
    "category" "PlotCategory" NOT NULL,
    "amenityName" TEXT,
    "size" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "status" "PlotStatus" NOT NULL DEFAULT 'available',
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "adjustmentReason" TEXT,
    "adjustmentDate" TIMESTAMP(3),
    "adjustmentBy" TEXT,
    "currentOwnerId" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "permissions" JSONB NOT NULL,
    "createdDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockAssignment" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,

    CONSTRAINT "BlockAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "membershipNo" TEXT,
    "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'minimal',
    "fullName" TEXT NOT NULL,
    "fatherOrHusbandName" TEXT,
    "cnic" TEXT NOT NULL,
    "city" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mailingAddress" TEXT,
    "nokName" TEXT,
    "nokCnic" TEXT,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'active',
    "passwordHash" TEXT,
    "credentialsPending" BOOLEAN NOT NULL DEFAULT true,
    "termsAccepted" BOOLEAN NOT NULL DEFAULT false,
    "termsAcceptedAt" TIMESTAMP(3),
    "strikeCount" INTEGER NOT NULL DEFAULT 0,
    "createdDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerStrike" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "receiptId" TEXT,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerStrike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "tokenFee" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "reservedByAdminId" TEXT NOT NULL,
    "reservedByAdminName" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByBookingId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByBookingId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByAdminId" TEXT,
    "resolutionNote" TEXT,
    "customerId" TEXT,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'minimal',
    "bookingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmationDate" TIMESTAMP(3),
    "paperInstallmentRef" TEXT,
    "installmentPlan" JSONB,
    "createdByAdminId" TEXT NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "feeType" "FeeType" NOT NULL,
    "installmentNumber" INTEGER,
    "dueDate" TIMESTAMP(3),
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSubmission" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "paymentRecordId" TEXT,
    "depositoryBank" TEXT NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receiptFileUrl" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'pending',
    "verifiedByAdminId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "slipNumber" TEXT,
    "securityHash" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDocument" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" "DocumentType" NOT NULL,
    "label" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeKb" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,

    CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocietyDocument" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "GeneratedDocType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSizeKb" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocietyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL,
    "section" "ContentSection" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lastModifiedBy" TEXT,
    "lastModifiedAt" TIMESTAMP(3),

    CONSTRAINT "ContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plot_blockId_status_idx" ON "Plot"("blockId", "status");

-- CreateIndex
CREATE INDEX "Plot_status_idx" ON "Plot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_blockId_plotNumber_key" ON "Plot"("blockId", "plotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BlockAssignment_adminId_blockId_key" ON "BlockAssignment"("adminId", "blockId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_membershipNo_key" ON "Customer"("membershipNo");

-- CreateIndex
CREATE INDEX "Customer_cnic_idx" ON "Customer"("cnic");

-- CreateIndex
CREATE INDEX "Reservation_plotId_status_idx" ON "Reservation"("plotId", "status");

-- CreateIndex
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");

-- CreateIndex
CREATE INDEX "PaymentRecord_bookingId_feeType_idx" ON "PaymentRecord"("bookingId", "feeType");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSubmission_slipNumber_key" ON "ReceiptSubmission"("slipNumber");

-- CreateIndex
CREATE INDEX "ReceiptSubmission_customerId_status_idx" ON "ReceiptSubmission"("customerId", "status");

-- CreateIndex
CREATE INDEX "SocietyDocument_customerId_idx" ON "SocietyDocument"("customerId");

-- CreateIndex
CREATE INDEX "SocietyDocument_bookingId_idx" ON "SocietyDocument"("bookingId");

-- CreateIndex
CREATE INDEX "AuditEntry_timestamp_idx" ON "AuditEntry"("timestamp");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_idx" ON "AuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEntry_actorId_idx" ON "AuditEntry"("actorId");

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockAssignment" ADD CONSTRAINT "BlockAssignment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockAssignment" ADD CONSTRAINT "BlockAssignment_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStrike" ADD CONSTRAINT "CustomerStrike_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSubmission" ADD CONSTRAINT "ReceiptSubmission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocietyDocument" ADD CONSTRAINT "SocietyDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocietyDocument" ADD CONSTRAINT "SocietyDocument_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
