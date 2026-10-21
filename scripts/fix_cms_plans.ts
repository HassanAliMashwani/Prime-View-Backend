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
  console.log('Aligning CMS plans in database...');

  // 1. Fix plan-7-5-marla title and subtitle
  await prisma.contentBlock.update({
    where: { id: 'plan-7-5-marla' },
    data: {
      title: '7.5 Marla Residential Plot',
      subtitle: 'Dimensions: 30 x 40 • Total Price: PKR 3,600,000',
    },
  });
  console.log('Updated plan-7-5-marla title to "7.5 Marla Residential Plot"');

  // 2. Fix plan-05-marla title and subtitle
  await prisma.contentBlock.update({
    where: { id: 'plan-05-marla' },
    data: {
      title: '05 Marla Residential Plot',
      subtitle: 'Dimensions: 25 x 50 • Total Price: PKR 2,500,000',
    },
  });
  console.log('Updated plan-05-marla title to "05 Marla Residential Plot"');

  // 3. Ensure plan-10-marla exists in DB
  const existing10 = await prisma.contentBlock.findUnique({
    where: { id: 'plan-10-marla' },
  });
  if (!existing10) {
    await prisma.contentBlock.create({
      data: {
        id: 'plan-10-marla',
        section: 'plans',
        title: '10 Marla Residential Plot',
        subtitle: 'Dimensions: 35 x 70 • Total Price: PKR 4,900,000',
        content: 'Standard 25% down payment of PKR 1,225,000, 39 monthly installments of PKR 48,000, 8 half-yearly installments of PKR 175,000, and PKR 400,000 on possession.',
        metadata: {
          price: 4900000,
          size: '35 x 70 (10 Marla)',
          downPayment: 'PKR 1,225,000 (25%)',
          monthly: 'PKR 48,000 x 39',
          halfYearly: 'PKR 175,000 x 8',
          possession: 'PKR 400,000',
          imageUrl: '/new assests/our plan assests/card 3.png',
          featured: true,
          tags: ['Residential', '10 Marla', 'Executive Family', 'Installments'],
        },
        lastModifiedBy: 'Chief Executive Officer (Super Admin)',
        lastModifiedAt: new Date(),
      },
    });
    console.log('Inserted missing plan-10-marla into ContentBlock');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
