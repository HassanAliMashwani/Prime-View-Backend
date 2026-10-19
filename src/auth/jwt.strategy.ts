import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super-secret-default-key-for-dev',
    });
  }

  async validate(payload: any) {
    if (payload.adminId || payload.role === 'super_admin' || payload.role === 'sub_admin') {
      const adminId = payload.adminId;
      if (!adminId) {
        throw new UnauthorizedException('Admin identifier missing in session token');
      }

      const admin = await this.prisma.adminUser.findUnique({
        where: { id: adminId },
        include: { assignments: true },
      });

      if (!admin) {
        throw new UnauthorizedException('Administrator account not found');
      }

      if (admin.status === 'suspended' || admin.status === 'inactive' || admin.status !== 'active') {
        throw new UnauthorizedException(`Account is ${admin.status}`);
      }

      return {
        ...payload,
        adminId: admin.id,
        role: admin.role,
        status: admin.status,
        fullName: admin.fullName,
        username: admin.username,
        email: admin.email,
        permissions: (admin.permissions as any) || {},
        assignedBlocks: admin.assignments.map((a) => a.blockId),
      };
    }

    return payload;
  }
}
