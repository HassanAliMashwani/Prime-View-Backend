import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { UpdateSubAdminDto } from './dto/update-sub-admin.dto';
import { ResetAdminPasswordDto } from './dto/reset-admin-password.dto';
import { ChangeAdminPasswordDto } from './dto/change-admin-password.dto';
import { MODULE_REGISTRY } from '../common/constants/module-registry';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  /**
   * GET /admin/audit
   * Retrieve system activity audit logs (Super Admin exclusive).
   */
  async getAuditLogs(session: any, filters?: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Audit log inspection is strictly restricted to Super Administrators.',
      });
    }

    const where: any = {};
    if (filters?.actorId) where.actorId = filters.actorId;
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.action) where.action = filters.action;
    
    if (filters?.startDate || filters?.endDate) {
      where.timestamp = {};
      if (filters?.startDate) where.timestamp.gte = new Date(filters.startDate);
      if (filters?.endDate) {
        const end = new Date(filters.endDate);
        end.setDate(end.getDate() + 1);
        where.timestamp.lt = end;
      }
    }

    if (filters?.search) {
      where.OR = [
        { details: { contains: filters.search, mode: 'insensitive' } },
        { actorName: { contains: filters.search, mode: 'insensitive' } },
        { action: { contains: filters.search, mode: 'insensitive' } },
        { entityId: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const parsedPageSize = Math.min(Number(filters?.pageSize) || 10, 10);
    const parsedPage = Math.max(1, Number(filters?.page) || 1);
    const skip = Math.max(0, (parsedPage - 1) * parsedPageSize);
    const take = parsedPageSize;

    let totalCount = 0;
    const logs = await this.prisma.withScopedSession(session, async (tx) => {
      totalCount = await tx.auditEntry.count({ where });
      const entries = await tx.auditEntry.findMany({
        where,
        skip,
        take,
        orderBy: { timestamp: 'desc' },
        select: {
          id: true,
          timestamp: true,
          actorId: true,
          actorName: true,
          actorRole: true,
          action: true,
          entityType: true,
          entityId: true,
          details: true,
        },
      });

      const entryIds = entries.map((e) => e.id);
      let diffMap = new Map<string, boolean>();
      if (entryIds.length > 0) {
        const diffs = await tx.$queryRaw<Array<{ id: string; hasDiff: boolean }>>`
          SELECT id, ("oldValue" IS NOT NULL OR "newValue" IS NOT NULL) AS "hasDiff"
          FROM "AuditEntry"
          WHERE id IN (${Prisma.join(entryIds)})
        `;
        diffMap = new Map(diffs.map((d) => [d.id, Boolean(d.hasDiff)]));
      }

      return entries.map((e) => ({
        ...e,
        hasDiff: diffMap.get(e.id) ?? false,
      }));
    });

    return { ok: true, logs, totalCount, page: parsedPage, pageSize: parsedPageSize };
  }

  /**
   * GET /admin/audit/:id
   * Retrieve diff details (oldValue and newValue) for a single audit log entry (Super Admin exclusive).
   */
  async getAuditLogDiff(session: any, id: string) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Audit log inspection is strictly restricted to Super Administrators.',
      });
    }

    const log = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.auditEntry.findUnique({
        where: { id },
        select: {
          id: true,
          oldValue: true,
          newValue: true,
        },
      });
    });

    if (!log) {
      throw new NotFoundException({
        error: 'AUDIT_LOG_NOT_FOUND',
        message: 'Audit log entry not found.',
      });
    }

    return { ok: true, id: log.id, oldValue: log.oldValue, newValue: log.newValue };
  }

  /**
   * 1. GET /admin/sub-admins
   * Retrieve all Sub Administrators (Super Admin exclusive).
   */
  async getSubAdmins(session: any, query: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Sub Admin management is strictly restricted to Super Administrators.',
      });
    }

    const page = Math.max(1, parseInt(query.page || '1', 10));
    const pageSize = 10;
    const skip = (page - 1) * pageSize;
    const where: any = { role: 'sub_admin' };

    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status && query.status !== 'all') {
      where.status = query.status.toLowerCase();
    }

    const [subAdmins, total] = await this.prisma.withScopedSession(session, async (tx) => {
      return Promise.all([
        tx.adminUser.findMany({
          where,
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            permissions: true,
            createdDate: true,
            lastLogin: true,
            assignments: {
              select: { blockId: true },
            },
          },
          orderBy: { createdDate: 'asc' },
          skip,
          take: pageSize,
        }),
        tx.adminUser.count({ where }),
      ]);
    });

    const formatted = subAdmins.map((u) => ({
      ...u,
      assignedBlocks: u.assignments.map((a) => a.blockId),
    }));

    return { 
      ok: true, 
      subAdmins: formatted,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 2. POST /admin/sub-admins
   * Create a new Sub Administrator with specific permissions and block scoping.
   */
  async createSubAdmin(dto: CreateSubAdminDto, session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Sub Admin creation is strictly restricted to Super Administrators.',
      });
    }

    const trimmedUsername = dto.username.trim().toLowerCase();
    const trimmedEmail = dto.email.trim().toLowerCase();

    if (!trimmedUsername || !trimmedEmail || !dto.fullName.trim() || !dto.password.trim()) {
      throw new BadRequestException({
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'All fields (full name, email, username, password) are required.',
      });
    }

    // Uniqueness checks
    const existingUser = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.adminUser.findFirst({
        where: {
          OR: [{ username: trimmedUsername }, { email: trimmedEmail }],
        },
      });
    });

    if (existingUser) {
      if (existingUser.username.toLowerCase() === trimmedUsername) {
        throw new ConflictException({
          error: 'USERNAME_TAKEN',
          message: `The username "${trimmedUsername}" is already taken.`,
        });
      }
      if (existingUser.email.toLowerCase() === trimmedEmail) {
        throw new ConflictException({
          error: 'EMAIL_ALREADY_IN_USE',
          message: `The email "${trimmedEmail}" is already registered.`,
        });
      }
    }

    const passwordHash = await bcrypt.hash(dto.password.trim(), 10);
    const sanitizedPermissions: Record<string, boolean> = {};
    for (const item of MODULE_REGISTRY) {
      sanitizedPermissions[item.key] = Boolean(dto.permissions?.[item.key as keyof typeof dto.permissions]);
    }

    const newAdminId = `admin-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const assignedBlocks = dto.assignedBlocks || [];

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const created = await tx.adminUser.create({
        data: {
          id: newAdminId,
          username: trimmedUsername,
          email: trimmedEmail,
          fullName: dto.fullName.trim(),
          passwordHash,
          role: 'sub_admin',
          status: 'active',
          permissions: sanitizedPermissions,
        },
      });

      if (assignedBlocks.length > 0) {
        await tx.blockAssignment.createMany({
          data: assignedBlocks.map((blockId) => ({
            adminId: newAdminId,
            blockId,
          })),
        });
      }

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'SUB_ADMIN_CREATED',
          entityType: 'sub_admin',
          entityId: newAdminId,
          details: `Created sub-admin ${created.fullName} (${created.username}) with scope: [${assignedBlocks.join(', ')}]`,
          newValue: {
            username: created.username,
            assignedBlocks,
            permissions: sanitizedPermissions,
          },
        },
      });

      return created;
    });

    await this.realtime.broadcast('sub_admins', 'SUB_ADMIN_CREATED', {
      adminId: result.id,
      username: result.username,
      fullName: result.fullName,
    });

    return {
      ok: true,
      subAdmin: {
        id: result.id,
        username: result.username,
        email: result.email,
        fullName: result.fullName,
        role: result.role,
        status: result.status,
        permissions: result.permissions,
        assignedBlocks,
      },
    };
  }

  /**
   * 3. PATCH /admin/sub-admins/:id
   * Update an existing Sub Administrator's permissions, assigned blocks, or status.
   */
  async updateSubAdmin(adminId: string, dto: UpdateSubAdminDto, session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Sub Admin updates are strictly restricted to Super Administrators.',
      });
    }

    const targetUser = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.adminUser.findUnique({
        where: { id: adminId },
        include: { assignments: true },
      });
    });

    if (!targetUser) {
      throw new NotFoundException({
        error: 'SUB_ADMIN_NOT_FOUND',
        message: 'Sub-admin user not found.',
      });
    }

    if (targetUser.role === 'super_admin') {
      throw new BadRequestException({
        error: 'CANNOT_MODIFY_SUPER_ADMIN',
        message: 'Super Administrator accounts cannot be modified via sub-admin endpoints.',
      });
    }

    const oldState = {
      fullName: targetUser.fullName,
      status: targetUser.status,
      assignedBlocks: targetUser.assignments.map((a) => a.blockId),
      permissions: targetUser.permissions,
    };

    const updatedPermissions = dto.permissions
      ? MODULE_REGISTRY.reduce((acc, item) => {
          const key = item.key;
          acc[key] = dto.permissions?.[key as keyof typeof dto.permissions] !== undefined
            ? Boolean(dto.permissions[key as keyof typeof dto.permissions])
            : Boolean((targetUser.permissions as any)?.[key]);
          return acc;
        }, {} as Record<string, boolean>)
      : targetUser.permissions;

    let passwordHash: string | undefined = undefined;
    if (dto.password && dto.password.trim().length > 0) {
      passwordHash = await bcrypt.hash(dto.password.trim(), 10);
    }

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const updated = await tx.adminUser.update({
        where: { id: adminId },
        data: {
          fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
          status: dto.status !== undefined ? dto.status : undefined,
          passwordHash: passwordHash !== undefined ? passwordHash : undefined,
          permissions: updatedPermissions,
        },
      });

      let currentBlocks = targetUser.assignments.map((a) => a.blockId);
      if (dto.assignedBlocks !== undefined) {
        await tx.blockAssignment.deleteMany({ where: { adminId } });
        if (dto.assignedBlocks.length > 0) {
          await tx.blockAssignment.createMany({
            data: dto.assignedBlocks.map((blockId) => ({ adminId, blockId })),
          });
        }
        currentBlocks = dto.assignedBlocks;
      }

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'SUB_ADMIN_UPDATED',
          entityType: 'sub_admin',
          entityId: adminId,
          details: `Updated sub-admin ${updated.fullName} (${updated.username})`,
          oldValue: oldState,
          newValue: {
            fullName: updated.fullName,
            status: updated.status,
            assignedBlocks: currentBlocks,
            permissions: updated.permissions,
          },
        },
      });

      return { user: updated, assignedBlocks: currentBlocks };
    });

    await this.realtime.broadcast('sub_admins', 'SUB_ADMIN_UPDATED', {
      adminId: result.user.id,
      username: result.user.username,
      status: result.user.status,
      assignedBlocks: result.assignedBlocks,
    });

    return {
      ok: true,
      subAdmin: {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email,
        fullName: result.user.fullName,
        role: result.user.role,
        status: result.user.status,
        permissions: result.user.permissions,
        assignedBlocks: result.assignedBlocks,
      },
    };
  }

  /**
   * 4. POST /admin/sub-admins/:id/reset-password
   * Super Admin resets password of another administrator.
   */
  async resetAdminPassword(adminId: string, dto: ResetAdminPasswordDto, session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Admin password resets are strictly restricted to Super Administrators.',
      });
    }

    if (adminId === session.adminId) {
      throw new BadRequestException({
        error: 'CANNOT_RESET_OWN_PASSWORD_VIA_SUB_ADMIN',
        message: 'Super Administrators cannot reset their own password via this endpoint.',
      });
    }

    const targetUser = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.adminUser.findUnique({
        where: { id: adminId },
      });
    });

    if (!targetUser) {
      throw new NotFoundException({
        error: 'SUB_ADMIN_NOT_FOUND',
        message: 'Target admin user not found.',
      });
    }

    if (targetUser.role === 'super_admin') {
      throw new BadRequestException({
        error: 'CANNOT_MODIFY_SUPER_ADMIN',
        message: 'Super Administrator accounts cannot be modified via sub-admin endpoints.',
      });
    }

    const passwordHash = await bcrypt.hash(dto.newPassword.trim(), 10);

    await this.prisma.withScopedSession(session, async (tx) => {
      await tx.adminUser.update({
        where: { id: adminId },
        data: { passwordHash },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'SUB_ADMIN_PASSWORD_RESET',
          entityType: 'sub_admin',
          entityId: adminId,
          details: `Password reset for sub-admin ${targetUser.fullName} (${targetUser.username})`,
        },
      });
    });

    return { ok: true, message: `Password reset successfully for ${targetUser.username}.` };
  }

  /**
   * 4b. DELETE /admin/sub-admins/:id
   * Super Admin permanently removes a sub-administrator account.
   */
  async deleteSubAdmin(adminId: string, session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Sub Admin deletion is strictly restricted to Super Administrators.',
      });
    }

    if (adminId === session.adminId) {
      throw new BadRequestException({
        error: 'CANNOT_DELETE_SELF',
        message: 'Super Administrators cannot delete their own account.',
      });
    }

    const targetUser = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.adminUser.findUnique({
        where: { id: adminId },
        include: { assignments: true },
      });
    });

    if (!targetUser) {
      throw new NotFoundException({
        error: 'SUB_ADMIN_NOT_FOUND',
        message: 'Sub-admin user not found.',
      });
    }

    if (targetUser.role === 'super_admin') {
      throw new BadRequestException({
        error: 'CANNOT_DELETE_SUPER_ADMIN',
        message: 'Super Administrator accounts cannot be deleted.',
      });
    }

    await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Delete associated block assignments
      await tx.blockAssignment.deleteMany({
        where: { adminId },
      });

      // 2. Delete the administrator record
      await tx.adminUser.delete({
        where: { id: adminId },
      });

      // 3. Record audit entry for governance & compliance
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'SUB_ADMIN_DELETED',
          entityType: 'sub_admin',
          entityId: adminId,
          details: `Deleted sub-admin ${targetUser.fullName} (@${targetUser.username})`,
          oldValue: {
            username: targetUser.username,
            fullName: targetUser.fullName,
            email: targetUser.email,
            assignedBlocks: targetUser.assignments.map((a) => a.blockId),
          },
        },
      });
    });

    await this.realtime.broadcast('sub_admins', 'SUB_ADMIN_DELETED', {
      adminId,
      username: targetUser.username,
      fullName: targetUser.fullName,
    });

    return {
      ok: true,
      message: `Sub-administrator "${targetUser.fullName}" (@${targetUser.username}) has been permanently deleted.`,
    };
  }

  /**
   * 5. GET /admin/profile
   * Self-service admin profile details.
   */
  async getProfile(session: any) {
    const adminId = session.adminId;
    if (!adminId) {
      throw new UnauthorizedException('Invalid session');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      include: { assignments: true },
    });

    if (!admin) {
      throw new NotFoundException('Administrator account not found');
    }

    return {
      ok: true,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        status: admin.status,
        permissions: admin.permissions,
        assignedBlocks: admin.assignments.map((a) => a.blockId),
        createdDate: admin.createdDate,
        lastLogin: admin.lastLogin,
      },
    };
  }

  /**
   * 6. POST /admin/change-password
   * Administrator self-service password update.
   */
  async changeOwnPassword(dto: ChangeAdminPasswordDto, session: any) {
    const adminId = session.adminId;
    if (!adminId) {
      throw new UnauthorizedException('Invalid session');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new NotFoundException('Administrator account not found');
    }

    const isValid = await bcrypt.compare(dto.oldPassword, admin.passwordHash);
    if (!isValid) {
      throw new BadRequestException({
        error: 'INVALID_CURRENT_PASSWORD',
        message: 'Current password does not match.',
      });
    }

    const passwordHash = await bcrypt.hash(dto.newPassword.trim(), 10);

    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });

    await this.prisma.auditEntry.create({
      data: {
        actorId: admin.id,
        actorName: admin.fullName,
        actorRole: admin.role,
        action: 'ADMIN_PASSWORD_CHANGED',
        entityType: 'admin_user',
        entityId: admin.id,
        details: `Password changed by administrator ${admin.fullName} (${admin.username})`,
      },
    });

    return { ok: true, message: 'Password changed successfully.' };
  }
}
