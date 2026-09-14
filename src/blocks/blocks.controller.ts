import { Controller, Get, UseGuards } from '@nestjs/common';
import { BlocksService } from './blocks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';

@Controller('blocks')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Get()
  async findAll(@CurrentSession() session: any) {
    return this.blocksService.findAll(session);
  }
}
