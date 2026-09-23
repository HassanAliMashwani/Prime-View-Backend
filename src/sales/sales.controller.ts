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

  @UseGuards(JwtAuthGuard)
  @Get('kpis')
  async getSalesKpis(@Request() req: any, @Query() query: any) {
    const history = await this.salesService.getSalesHistory(req.user, query);
    return { ok: true, kpis: history.kpis };
  }

  @UseGuards(JwtAuthGuard)
  @Get('reports')
  async getSalesReports(@Request() req: any, @Query() query: any) {
    const history = await this.salesService.getSalesHistory(req.user, query);
    return { ok: true, items: history.items, metrics: history.kpis };
  }
}
