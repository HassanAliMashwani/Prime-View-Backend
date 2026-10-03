import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('admin/login')
  async adminLogin(@Body() body: Record<string, string>) {
    return this.authService.adminLogin(body.username, body.password);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('member/login')
  async memberLogin(@Body() body: Record<string, string>) {
    return this.authService.memberLogin(body.membershipNo, body.password);
  }
}

