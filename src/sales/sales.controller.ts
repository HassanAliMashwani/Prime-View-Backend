import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @UseGuards(JwtAuthGuard)
  @Get('history')
  async getSalesHistory(@Request() req: any, @Query() query: any) {
    return this.salesService.getSalesHistory(req.user, query);
  }
}
