import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function main() {
  const blocks = await prisma.contentBlock.findMany({
    where: { section: 'plans' },
    orderBy: { id: 'asc' },
  });
  console.log(`Found ${blocks.length} plan blocks:`);
  for (const b of blocks) {
    console.log(JSON.stringify(b, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
