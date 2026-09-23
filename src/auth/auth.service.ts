import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly MAX_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async adminLogin(username: string, pass: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { username },
      include: { assignments: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check rate limit / lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account locked due to too many failed attempts. Try again later.');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);

    if (!isMatch) {
      // Increment failed attempts
      const newCount = user.failedLoginAttempts + 1;
      const lockedUntil = newCount >= this.MAX_ATTEMPTS ? new Date(Date.now() + this.LOCKOUT_DURATION_MS) : null;
      
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: newCount, lockedUntil },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset attempts on success
    if (user.failedLoginAttempts > 0) {
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
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
    const customer = await this.prisma.customer.findUnique({
      where: { membershipNo },
    });

    if (!customer) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (customer.accountStatus === 'suspended') {
      // Exact response string as specified in requirements
      throw new ForbiddenException('Your account is suspended. Please contact admin.');
    }

    // Check rate limit / lockout
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account locked due to too many failed attempts. Try again later.');
    }

    const isMatch = await bcrypt.compare(pass, customer.passwordHash);

    if (!isMatch) {
      const newCount = customer.failedLoginAttempts + 1;
      const lockedUntil = newCount >= this.MAX_ATTEMPTS ? new Date(Date.now() + this.LOCKOUT_DURATION_MS) : null;
      
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { failedLoginAttempts: newCount, lockedUntil },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset attempts on success
    if (customer.failedLoginAttempts > 0) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLogin: new Date(),
        },
      });
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
