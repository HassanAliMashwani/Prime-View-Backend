import { Injectable, UnauthorizedException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly MAX_ATTEMPTS = 5;
  private readonly REFILL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes per single try refill
  private readonly ACCOUNT_BURST_WINDOW_MS = 30 * 1000; // 30s sliding window
  private readonly ACCOUNT_BURST_MAX = 5; // max 5 rapid attempts per account

  private readonly accountBurstMap = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * Protects individual accounts from burst flooding attacks.
   * Throws HTTP 429 if more than ACCOUNT_BURST_MAX requests hit the same account identifier within the window.
   */
  private checkAccountBurst(identifier: string) {
    const now = Date.now();
    const timestamps = this.accountBurstMap.get(identifier) || [];
    const recent = timestamps.filter(t => now - t < this.ACCOUNT_BURST_WINDOW_MS);

    if (recent.length >= this.ACCOUNT_BURST_MAX) {
      throw new HttpException(
        'Too many login requests for this account. Please wait before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.accountBurstMap.set(identifier, recent);

    // Garbage-collect old tracking keys to avoid memory leaks
    if (this.accountBurstMap.size > 2000) {
      for (const [key, times] of this.accountBurstMap.entries()) {
        if (times.every(t => now - t > this.ACCOUNT_BURST_WINDOW_MS)) {
          this.accountBurstMap.delete(key);
        }
      }
    }
  }

  /**
   * Calculates effective failure count under the one-try-every-15-minutes refill model.
   * - 5 max attempts.
   * - At 5, lockedUntil is set to (now + 15 min).
   * - Each 15 minutes elapsed thereafter refills exactly 1 try.
   * - Tries return one at a time; they never jump from 0 back to 5 on one tick.
   * - When count < 5, lockedUntil stores the last failure timestamp.
   */
  private calculateEffectiveFailures(
    attempts: number,
    lockedUntil: Date | null,
    now: Date = new Date(),
  ): { effectiveCount: number; isLocked: boolean; waitMs: number } {
    if (attempts <= 0 || !lockedUntil) {
      return { effectiveCount: 0, isLocked: false, waitMs: 0 };
    }

    const nowMs = now.getTime();
    const lockMs = lockedUntil.getTime();

    // If account reached max attempts, lockedUntil was set to the lockout expiry
    if (attempts >= this.MAX_ATTEMPTS) {
      if (nowMs < lockMs) {
        return {
          effectiveCount: this.MAX_ATTEMPTS,
          isLocked: true,
          waitMs: lockMs - nowMs,
        };
      }
      // At least 15 minutes have passed since the 5th failure.
      // 1 try returned at lockMs, plus 1 more for every full 15 minutes after lockMs.
      const elapsedSinceLockEnd = nowMs - lockMs;
      const refilled = 1 + Math.floor(elapsedSinceLockEnd / this.REFILL_INTERVAL_MS);
      const effectiveCount = Math.max(0, attempts - refilled);
      return { effectiveCount, isLocked: false, waitMs: 0 };
    }

    // For attempts < 5, lockedUntil holds the last failure timestamp.
    const elapsedSinceLastFailure = nowMs - lockMs;
    const refilled = Math.floor(elapsedSinceLastFailure / this.REFILL_INTERVAL_MS);
    const effectiveCount = Math.max(0, attempts - refilled);
    return { effectiveCount, isLocked: false, waitMs: 0 };
  }

  async adminLogin(username: string, pass: string) {
    if (!username || !pass) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    this.checkAccountBurst(`admin:${username.toLowerCase().trim()}`);

    const user = await this.prisma.adminUser.findUnique({
      where: { username },
      include: { assignments: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const now = new Date();
    const status = this.calculateEffectiveFailures(user.failedLoginAttempts, user.lockedUntil, now);

    if (status.isLocked) {
      throw new UnauthorizedException('Account locked due to too many failed attempts.');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);

    if (!isMatch) {
      // Each wrong password uses one try
      const newCount = status.effectiveCount + 1;
      // At 5, the next try waits 15 minutes. Otherwise store current failure timestamp.
      const lockedUntil = newCount >= this.MAX_ATTEMPTS
        ? new Date(now.getTime() + this.REFILL_INTERVAL_MS)
        : now;

      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: newCount, lockedUntil },
      });

      // Audit log failed login
      try {
        await this.prisma.auditEntry.create({
          data: {
            actorId: user.id,
            actorName: user.fullName,
            actorRole: user.role,
            action: 'ADMIN_LOGIN_FAILURE',
            entityType: 'AdminUser',
            entityId: user.id,
            details: `Failed admin login attempt for ${user.username}. Consecutive failure count: ${newCount}`,
          },
        });
      } catch {
        // Drop that failure. Write none of its text into the response, the log, or any database column.
      }

      throw new UnauthorizedException('Invalid credentials.');
    }

    // A correct password clears that account’s failures
    if (user.failedLoginAttempts > 0 || user.lockedUntil !== null) {
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    // Audit log successful login
    try {
      await this.prisma.auditEntry.create({
        data: {
          actorId: user.id,
          actorName: user.fullName,
          actorRole: user.role,
          action: 'ADMIN_LOGIN_SUCCESS',
          entityType: 'AdminUser',
          entityId: user.id,
          details: `Admin ${user.username} authenticated successfully.`,
        },
      });
    } catch {
      // If writing the audit row fails during login, still return the normal login token when the password is correct. Drop that failure. Write none of its text into the response, the log, or any database column.
    }

    const payload = {
      adminId: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      assignedBlocks: user.assignments.map(a => a.blockId),
      permissions: user.permissions,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async memberLogin(membershipNo: string, pass: string) {
    if (!membershipNo || !pass) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    this.checkAccountBurst(`member:${membershipNo.toLowerCase().trim()}`);

    const customer = await this.prisma.customer.findUnique({
      where: { membershipNo },
    });

    if (!customer) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (customer.accountStatus === 'suspended') {
      throw new ForbiddenException('Your account is suspended. Please contact admin.');
    }

    const now = new Date();
    const status = this.calculateEffectiveFailures(customer.failedLoginAttempts, customer.lockedUntil, now);

    if (status.isLocked) {
      throw new UnauthorizedException('Account locked due to too many failed attempts.');
    }

    if (!customer.passwordHash) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isMatch = await bcrypt.compare(pass, customer.passwordHash);

    if (!isMatch) {
      const newCount = status.effectiveCount + 1;
      const lockedUntil = newCount >= this.MAX_ATTEMPTS
        ? new Date(now.getTime() + this.REFILL_INTERVAL_MS)
        : now;

      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { failedLoginAttempts: newCount, lockedUntil },
      });

      // Audit log failed member login
      try {
        await this.prisma.auditEntry.create({
          data: {
            actorId: customer.id,
            actorName: customer.fullName,
            actorRole: 'customer',
            action: 'MEMBER_LOGIN_FAILURE',
            entityType: 'Customer',
            entityId: customer.id,
            details: `Failed member login attempt for ${customer.membershipNo}. Consecutive failure count: ${newCount}`,
          },
        });
      } catch {
        // Drop that failure.
      }

      throw new UnauthorizedException('Invalid credentials.');
    }

    // A correct password clears that account’s failures
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLogin: now,
      },
    });

    // Audit log successful member login
    try {
      await this.prisma.auditEntry.create({
        data: {
          actorId: customer.id,
          actorName: customer.fullName,
          actorRole: 'customer',
          action: 'MEMBER_LOGIN_SUCCESS',
          entityType: 'Customer',
          entityId: customer.id,
          details: `Member ${customer.membershipNo} authenticated successfully.`,
        },
      });
    } catch {
      // If writing the audit row fails during login, still return the normal login token when the password is correct. Drop that failure. Write none of its text into the response, the log, or any database column.
    }

    const payload = {
      customerId: customer.id,
      role: 'customer',
      fullName: customer.fullName,
      email: customer.email,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}

