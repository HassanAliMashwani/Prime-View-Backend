import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionScopeGuard } from '../auth/guards/permission-scope.guard';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { UpdateSubAdminDto } from './dto/update-sub-admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('sub-admins')
  async getSubAdmins(@CurrentSession() session: any) {
    return this.adminService.getSubAdmins(session);
  }

  @Post('sub-admins')
  @HttpCode(HttpStatus.CREATED)
  async createSubAdmin(
    @Body() dto: CreateSubAdminDto,
    @CurrentSession() session: any,
  ) {
    return this.adminService.createSubAdmin(dto, session);
  }

  @Patch('sub-admins/:id')
  @HttpCode(HttpStatus.OK)
  async updateSubAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateSubAdminDto,
    @CurrentSession() session: any,
  ) {
    return this.adminService.updateSubAdmin(id, dto, session);
  }
}
