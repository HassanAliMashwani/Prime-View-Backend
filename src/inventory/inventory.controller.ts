import { Controller, Get, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Request } from 'express';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('stats')
  @RequirePermission('can_view_inventory')
  async getInventoryStats(
    @Req() req: Request,
    @Query() query: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('blockId') blockId?: string,
  ) {
    const session = req.user as any;

    if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (toDate < fromDate) {
        throw new BadRequestException('To date cannot be before From date');
      }
    }

    return this.inventoryService.getStats(session, from, to, blockId, query);
  }

  @Get('live')
  @RequirePermission('can_view_inventory')
  async getLiveStats(
    @Req() req: Request,
    @Query() query: any,
    @Query('blockId') blockId?: string,
  ) {
    const session = req.user as any;
    return this.inventoryService.getLiveStats(session, blockId, query);
  }

  @Get('history')
  @RequirePermission('can_view_inventory')
  async getInventoryHistory(
    @Req() req: Request,
    @Query() query: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('range') range?: string,
    @Query('blockId') blockId?: string,
  ) {
    const session = req.user as any;

    if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (toDate < fromDate) {
        throw new BadRequestException('To date cannot be before From date');
      }
    }

    return this.inventoryService.getHistory(session, from, to, blockId, query, range);
  }
}
