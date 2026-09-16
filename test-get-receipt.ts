import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const receipt = await prisma.receiptSubmission.findFirst({ where: { slipNumber: { not: null } } });
  console.log(receipt);
}
main().finally(() => prisma.$disconnect());