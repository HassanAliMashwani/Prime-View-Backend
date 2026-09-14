import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { BlocksModule } from './blocks/blocks.module';
import { PlotsModule } from './plots/plots.module';
import { CustomersModule } from './customers/customers.module';
import { MeModule } from './me/me.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReservationsModule } from './reservations/reservations.module';
import { AdminModule } from './admin/admin.module';
import { ContentModule } from './content/content.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { SweepModule } from './sweep/sweep.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    RealtimeModule,
    AuthModule,
    BlocksModule,
    PlotsModule,
    ReservationsModule,
    CustomersModule,
    MeModule,
    AdminModule,
    ContentModule,
    ReceiptsModule,
    SweepModule,
    StorageModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}

