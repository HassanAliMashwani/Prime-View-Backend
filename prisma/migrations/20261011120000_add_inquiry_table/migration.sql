-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "consent" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- Enable and force Row Level Security
ALTER TABLE "Inquiry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Inquiry" FORCE ROW LEVEL SECURITY;

-- Add one insert policy so this public form can insert a row
DROP POLICY IF EXISTS inquiry_insert_public ON "Inquiry";
CREATE POLICY inquiry_insert_public ON "Inquiry"
  FOR INSERT
  WITH CHECK (true);
