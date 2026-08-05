import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './auth.guards';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import type { AuthUser } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.auth.register(body.email, body.password, body.name, body.signupPassword);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  login(@Req() req: Request & { user: AuthUser }, @Body() _body: LoginDto) {
    return this.auth.loginUser(req.user.id);
  }

  @Post('refresh')
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  logout(@Body() body: RefreshDto) {
    return this.auth.logout(body.refreshToken).then(() => ({ ok: true }));
  }
}
