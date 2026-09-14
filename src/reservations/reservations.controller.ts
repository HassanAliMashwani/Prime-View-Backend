import {
  Controller,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';

@Controller('reservations')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('id') id: string, @CurrentSession() session: any) {
    return this.reservationsService.confirm(id, session);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  async release(@Param('id') id: string, @CurrentSession() session: any) {
    return this.reservationsService.release(id, session);
  }

  @Patch(':id/note')
  @HttpCode(HttpStatus.OK)
  async updateNote(
    @Param('id') id: string,
    @Body('note') note: string,
    @CurrentSession() session: any,
  ) {
    return this.reservationsService.updateNote(id, note || '', session);
  }
}
