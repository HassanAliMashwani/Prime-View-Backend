import { Controller, Get, UseGuards, ForbiddenException } from '@nestjs/common';
import { MeService } from './me.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('plots')
  async getPlots(@CurrentSession() session: any) {
    if (session.role !== 'customer') {
      throw new ForbiddenException('Only customers can access this route');
    }
    return this.meService.getPlots(session.customerId);
  }

  @Get('payments')
  async getPayments(@CurrentSession() session: any) {
    if (session.role !== 'customer') {
      throw new ForbiddenException('Only customers can access this route');
    }
    return this.meService.getPayments(session.customerId);
  }
}
