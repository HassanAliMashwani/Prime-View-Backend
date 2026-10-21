import { Controller, Post, Body, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('admin/login')
  async adminLogin(
    @Body() body: Record<string, string>,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.authService.adminLogin(body.username, body.password);
    if (res && typeof res.cookie === 'function') {
      // 23 hours in milliseconds: 23 * 60 * 60 * 1000 = 82,800,000 ms
      res.cookie('pv_admin_session', body.username?.toLowerCase()?.trim(), {
        maxAge: 23 * 60 * 60 * 1000,
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
      });
    }
    return result;
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('member/login')
  async memberLogin(@Body() body: Record<string, string>) {
    return this.authService.memberLogin(body.membershipNo, body.password);
  }
}

