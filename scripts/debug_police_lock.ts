import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PlotsService } from '../src/plots/plots.service';
import { CustomersService } from '../src/customers/customers.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const plotsService = app.get(PlotsService);
  const prisma = app.get(PrismaService);

  const police = await prisma.adminUser.findUnique({ where: { username: 'police' } });
  console.log('Police admin:', police);

  const assignments = await prisma.blockAssignment.findMany({ where: { adminId: police?.id } });
  const session = {
    adminId: police?.id,
    username: police?.username,
    role: police?.role,
    assignedBlocks: assignments.map(a => a.blockId),
    permissions: police?.permissions,
  };

  const plot = await prisma.plot.findFirst({
    where: { blockId: 'elite', plotNumber: '238' },
  });
  console.log('Test plot:', plot);

  if (!plot) {
    console.error('No test plot found');
    return;
  }

  try {
    console.log('\n--- Calling bookPlot on plot-el-238 ---');
    const bookRes = await plotsService.bookPlot(plot.id, {
      paymentType: 'one_time',
      customer: {
        fullName: 'Police Test Buyer 2',
        cnic: '37405-9999999-2',
        phone: '+923009999998',
        email: 'police.buyer2@test.pk',
        city: 'Abbottabad',
      },
    }, session);
    console.log('Book success:', bookRes);
  } catch (err: any) {
    console.error('Book error caught:');
    console.error(err);
    if (err.response) console.error('Error response:', err.response);
  }

  await app.close();
}

main().catch(console.error);
