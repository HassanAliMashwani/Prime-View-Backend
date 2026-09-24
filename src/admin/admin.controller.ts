import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { ResetAdminPasswordDto } from './dto/reset-admin-password.dto';
import { ChangeAdminPasswordDto } from './dto/change-admin-password.dto';
import { MODULE_REGISTRY } from '../common/constants/module-registry';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionScopeGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('modules')
  async getModules() {
    return { ok: true, modules: MODULE_REGISTRY };
  }

  @Get('sub-admins')
  async getSubAdmins(@CurrentSession() session: any) {
    return this.adminService.getSubAdmins(session);
  }

  @Get('audit')
  async getAuditLogs(@CurrentSession() session: any) {
    return this.adminService.getAuditLogs(session);
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

  @Post('sub-admins/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetAdminPassword(
    @Param('id') id: string,
    @Body() dto: ResetAdminPasswordDto,
    @CurrentSession() session: any,
  ) {
    return this.adminService.resetAdminPassword(id, dto, session);
  }

  @Delete('sub-admins/:id')
  @HttpCode(HttpStatus.OK)
  async deleteSubAdmin(
    @Param('id') id: string,
    @CurrentSession() session: any,
  ) {
    return this.adminService.deleteSubAdmin(id, session);
  }

  @Get('profile')
  async getProfile(@CurrentSession() session: any) {
    return this.adminService.getProfile(session);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangeAdminPasswordDto,
    @CurrentSession() session: any,
  ) {
    return this.adminService.changeOwnPassword(dto, session);
  }
}
