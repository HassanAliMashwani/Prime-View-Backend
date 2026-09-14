import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { SaveContentBlockDto } from './dto/save-content-block.dto';
import { ContentSection } from '@prisma/client';

@Injectable()
export class ContentService {
  private readonly lockExpiryMs = 30 * 60 * 1000; // 30 minutes

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  /**
   * 1. GET /content
   * List all CMS content blocks with optional section filtering ('plans' | 'events').
   */
  async getContentBlocks(section?: 'plans' | 'events') {
    const where: any = {};
    if (section) {
      where.section = section as ContentSection;
    }

    const blocks = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.contentBlock.findMany({
        where,
        orderBy: { lastModifiedAt: 'desc' },
      });
    });

    // Check expired locks and enrich with lockedByName
    const now = Date.now();
    const enriched = await Promise.all(
      blocks.map(async (block) => {
        let isLockActive = false;
        let lockedByName: string | null = null;

        if (block.lockedBy && block.lockedAt) {
          if (now - block.lockedAt.getTime() <= this.lockExpiryMs) {
            isLockActive = true;
            const admin = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
              return tx.adminUser.findUnique({
                where: { id: block.lockedBy! },
                select: { fullName: true, username: true },
              });
            });
            lockedByName = admin ? (admin.fullName || admin.username) : 'Another Administrator';
          }
        }

        return {
          ...block,
          lockedBy: isLockActive ? block.lockedBy : null,
          lockedAt: isLockActive ? block.lockedAt : null,
          lockedByName: isLockActive ? lockedByName : null,
        };
      }),
    );

    return { ok: true, blocks: enriched };
  }

  /**
   * 2. POST /content/:id/lock or /content/blocks/:id/lock
   * Acquire a 30-minute soft edit lock on a CMS content block.
   */
  async acquireContentLock(blockId: string, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_edit_content) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to edit CMS content blocks.',
      });
    }

    const now = new Date();

    const block = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.contentBlock.findUnique({ where: { id: blockId } });
    });

    if (!block) {
      throw new NotFoundException({
        error: 'CONTENT_BLOCK_NOT_FOUND',
        message: 'Content block not found.',
      });
    }

    // Check if locked by another admin and not expired (30m)
    if (block.lockedBy && block.lockedBy !== session.adminId) {
      if (block.lockedAt && now.getTime() - block.lockedAt.getTime() <= this.lockExpiryMs) {
        const lockingAdmin = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
          return tx.adminUser.findUnique({
            where: { id: block.lockedBy! },
            select: { fullName: true, username: true },
          });
        });

        const lockedByName = lockingAdmin ? (lockingAdmin.fullName || lockingAdmin.username) : 'Another Administrator';

        throw new ConflictException({
          error: 'LOCKED_BY_ANOTHER',
          message: `This content block is currently locked and being edited by ${lockedByName}.`,
          lockedByName,
          lockedAt: block.lockedAt.getTime(),
        });
      }
    }

    // Acquire lock in transaction
    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const updated = await tx.contentBlock.update({
        where: { id: blockId },
        data: {
          lockedBy: session.adminId,
          lockedAt: now,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CONTENT_LOCK_ACQUIRED',
          entityType: 'content',
          entityId: blockId,
          details: `Admin ${session.fullName || session.username} acquired 30m CMS edit lock on "${block.title}"`,
          newValue: { lockedBy: session.adminId, lockedAt: now },
        },
      });

      return updated;
    });

    await this.realtime.broadcast('content', 'CONTENT_LOCKED', {
      contentBlockId: blockId,
      lockedBy: session.adminId,
      lockedByName: session.fullName || session.username,
      lockedAt: now.getTime(),
    });

    return {
      ok: true,
      block: {
        ...result,
        lockedByName: session.fullName || session.username,
      },
    };
  }

  /**
   * 3. POST /content/:id/release-lock or DELETE /content/:id/lock
   * Release an active CMS content edit lock.
   */
  async releaseContentLock(blockId: string, session: any) {
    const block = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.contentBlock.findUnique({ where: { id: blockId } });
    });

    if (!block) {
      throw new NotFoundException({
        error: 'CONTENT_BLOCK_NOT_FOUND',
        message: 'Content block not found.',
      });
    }

    if (block.lockedBy !== session.adminId && session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'NOT_LOCK_HOLDER',
        message: 'Only the lock holder or a Super Admin can release this CMS edit lock.',
      });
    }

    await this.prisma.withScopedSession(session, async (tx) => {
      await tx.contentBlock.update({
        where: { id: blockId },
        data: {
          lockedBy: null,
          lockedAt: null,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CONTENT_LOCK_RELEASED',
          entityType: 'content',
          entityId: blockId,
          details: `Released CMS edit lock on "${block.title}"`,
        },
      });
    });

    await this.realtime.broadcast('content', 'CONTENT_UNLOCKED', {
      contentBlockId: blockId,
      reason: 'MANUAL_RELEASE',
    });

    return { ok: true };
  }

  /**
   * 4. POST /content/:id/save or /content/blocks/:id/save
   * Save updates to a content block atomically and release edit lock.
   */
  async saveContentBlock(blockId: string, dto: SaveContentBlockDto, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_edit_content) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to edit CMS content blocks.',
      });
    }

    const now = new Date();

    const block = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.contentBlock.findUnique({ where: { id: blockId } });
    });

    if (!block) {
      throw new NotFoundException({
        error: 'CONTENT_BLOCK_NOT_FOUND',
        message: 'Content block not found.',
      });
    }

    // Verify lock ownership: if locked by another and unexpired, reject with LOCK_LOST
    if (block.lockedBy && block.lockedBy !== session.adminId && session.role !== 'super_admin') {
      if (block.lockedAt && now.getTime() - block.lockedAt.getTime() <= this.lockExpiryMs) {
        throw new ConflictException({
          error: 'LOCK_LOST',
          message: 'Edit lock was lost or belongs to another admin.',
        });
      }
    }

    const existingMetadata = (block.metadata as Record<string, any>) || {};
    const updatedMetadata = {
      ...existingMetadata,
      ...(dto.category ? { category: dto.category.trim() } : {}),
      ...(dto.metadata || {}),
    };

    const oldSnapshot = {
      title: block.title,
      subtitle: block.subtitle,
      content: block.content,
      metadata: block.metadata,
    };

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const updated = await tx.contentBlock.update({
        where: { id: blockId },
        data: {
          title: dto.title !== undefined ? dto.title.trim() : block.title,
          subtitle: dto.subtitle !== undefined ? dto.subtitle.trim() : block.subtitle,
          content: dto.content !== undefined ? dto.content.trim() : block.content,
          metadata: updatedMetadata,
          lastModifiedBy: session.fullName || session.username,
          lastModifiedAt: now,
          lockedBy: null,
          lockedAt: null,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CONTENT_UPDATED',
          entityType: 'content',
          entityId: blockId,
          details: `Updated content block "${updated.title}" (${updated.section})`,
          oldValue: oldSnapshot,
          newValue: {
            title: updated.title,
            subtitle: updated.subtitle,
            content: updated.content,
            metadata: updated.metadata,
          },
        },
      });

      return updated;
    });

    await this.realtime.broadcast('content', 'CONTENT_SAVED', {
      contentBlockId: blockId,
      modifiedBy: session.fullName || session.username,
    });

    await this.realtime.broadcast('content', 'CONTENT_UNLOCKED', {
      contentBlockId: blockId,
      reason: 'SAVE_COMPLETED',
    });

    return { ok: true, block: result };
  }

  /**
   * 5. POST /content
   * Create a new content block (plan or event) in the CMS.
   */
  async createContentBlock(dto: CreateContentBlockDto, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_edit_content) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to create CMS content blocks.',
      });
    }

    if (!dto.title?.trim() || !dto.content?.trim()) {
      throw new BadRequestException({
        error: 'TITLE_AND_CONTENT_REQUIRED',
        message: 'Title and content are required.',
      });
    }

    const id = `${dto.section === 'plans' ? 'plan' : 'event'}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date();

    const metadata = {
      category: dto.category?.trim() || (dto.section === 'plans' ? 'residential' : 'ceremony'),
      ...(dto.metadata || {}),
    };

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const created = await tx.contentBlock.create({
        data: {
          id,
          section: dto.section as ContentSection,
          title: dto.title.trim(),
          subtitle: dto.subtitle?.trim() || null,
          content: dto.content.trim(),
          metadata,
          lastModifiedBy: session.fullName || session.username,
          lastModifiedAt: now,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CONTENT_CREATED',
          entityType: 'content',
          entityId: id,
          details: `Created new ${dto.section} content block: "${created.title}"`,
          newValue: created as any,
        },
      });

      return created;
    });

    await this.realtime.broadcast('content', 'CONTENT_CREATED', {
      contentBlockId: id,
      createdBy: session.fullName || session.username,
    });

    return { ok: true, block: result };
  }

  /**
   * 6. DELETE /content/:id or /content/blocks/:id
   * Delete a content block from the CMS.
   */
  async deleteContentBlock(blockId: string, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_edit_content) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to delete CMS content blocks.',
      });
    }

    const block = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.contentBlock.findUnique({ where: { id: blockId } });
    });

    if (!block) {
      throw new NotFoundException({
        error: 'CONTENT_BLOCK_NOT_FOUND',
        message: 'Content block not found.',
      });
    }

    await this.prisma.withScopedSession(session, async (tx) => {
      await tx.contentBlock.delete({ where: { id: blockId } });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CONTENT_DELETED',
          entityType: 'content',
          entityId: blockId,
          details: `Deleted ${block.section} content block: "${block.title}"`,
        },
      });
    });

    await this.realtime.broadcast('content', 'CONTENT_DELETED', {
      contentBlockId: blockId,
      deletedBy: session.fullName || session.username,
    });

    return { ok: true };
  }
}
