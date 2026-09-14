import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('admin/login')
  async adminLogin(@Body() body: Record<string, string>) {
    return this.authService.adminLogin(body.username, body.password);
  }

  @Post('member/login')
  async memberLogin(@Body() body: Record<string, string>) {
    return this.authService.memberLogin(body.membershipNo, body.password);
  }
}
