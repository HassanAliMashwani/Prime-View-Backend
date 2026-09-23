import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { UpdateSubAdminDto } from './dto/update-sub-admin.dto';
import { ResetAdminPasswordDto } from './dto/reset-admin-password.dto';
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
  async getAuditLogs(session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Audit log inspection is strictly restricted to Super Administrators.',
      });
    }

    const logs = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.auditEntry.findMany({
        orderBy: { timestamp: 'desc' },
      });
    });

    return { ok: true, logs, totalCount: logs.length };
  }

  /**
   * 1. GET /admin/sub-admins
   * Retrieve all Sub Administrators (Super Admin exclusive).
   */
  async getSubAdmins(session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        message: 'Sub Admin management is strictly restricted to Super Administrators.',
      });
    }

    const subAdmins = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.adminUser.findMany({
        where: { role: 'sub_admin' },
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
      });
    });

    const formatted = subAdmins.map((u) => ({
      ...u,
      assignedBlocks: u.assignments.map((a) => a.blockId),
    }));

    return { ok: true, subAdmins: formatted };
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
}
