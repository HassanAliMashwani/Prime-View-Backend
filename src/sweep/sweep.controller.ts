import { Controller, Get, Post, UseGuards, ForbiddenException } from '@nestjs/common';
import { SweepService } from './sweep.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';

@Controller('sweep')
export class SweepController {
  constructor(private readonly sweepService: SweepService) {}

  @Get('status')
  getStatus() {
    return {
      ok: true,
      data: this.sweepService.getStatus(),
    };
  }

  @Post('run')
  @UseGuards(JwtAuthGuard, PermissionScopeGuard)
  async triggerManualSweep(@CurrentSession() session: any) {
    if (session?.role !== 'super_admin') {
      throw new ForbiddenException('FORBIDDEN_SUPER_ADMIN_ONLY');
    }
    const result = await this.sweepService.runSweep();
    return {
      ok: true,
      data: result,
      status: this.sweepService.getStatus(),
    };
  }
}
