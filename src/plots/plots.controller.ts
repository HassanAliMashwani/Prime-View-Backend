import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PlotsService } from './plots.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { ReservePlotDto } from './dto/reserve-plot.dto';
import { BookPlotDto } from './dto/book-plot.dto';
import { TogglePlotAdjustmentDto } from './dto/toggle-adjustment.dto';
import { UpdatePlotPriceDto } from './dto/update-plot-price.dto';

@Controller('plots')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class PlotsController {
  constructor(private readonly plotsService: PlotsService) {}

  @Get()
  async findAll(@Query('blockId') blockId: string, @CurrentSession() session: any) {
    return this.plotsService.findAll(blockId, session);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentSession() session: any) {
    return this.plotsService.findOne(id, session);
  }

  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  async acquireLock(@Param('id') id: string, @CurrentSession() session: any) {
    return this.plotsService.acquireLock(id, session);
  }

  @Delete(':id/lock')
  @HttpCode(HttpStatus.OK)
  async releaseLock(@Param('id') id: string, @CurrentSession() session: any) {
    return this.plotsService.releaseLock(id, session);
  }

  @Post(':id/reserve')
  @HttpCode(HttpStatus.CREATED)
  async reservePlot(
    @Param('id') id: string,
    @Body() dto: ReservePlotDto,
    @CurrentSession() session: any,
  ) {
    return this.plotsService.reservePlot(id, dto, session);
  }

  @Post(':id/book')
  @HttpCode(HttpStatus.CREATED)
  async bookPlot(
    @Param('id') id: string,
    @Body() dto: BookPlotDto,
    @CurrentSession() session: any,
  ) {
    return this.plotsService.bookPlot(id, dto, session);
  }

  @Post(':id/adjustment')
  @HttpCode(HttpStatus.OK)
  async toggleAdjustment(
    @Param('id') id: string,
    @Body() dto: TogglePlotAdjustmentDto,
    @CurrentSession() session: any,
  ) {
    return this.plotsService.toggleAdjustment(id, dto, session);
  }

  @Patch(':id/price')
  @HttpCode(HttpStatus.OK)
  async updatePlotPrice(
    @Param('id') id: string,
    @Body() dto: UpdatePlotPriceDto,
    @CurrentSession() session: any,
  ) {
    return this.plotsService.updatePlotPrice(id, dto, session);
  }
}
