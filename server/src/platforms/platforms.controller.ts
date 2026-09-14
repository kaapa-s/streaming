import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { isPlatformProvider } from './platform-ids';
import { PlatformConnectionStore } from './platform-connection.store';
import { PlatformOAuthRegistry } from './platform-oauth.registry';

@Controller('platforms')
export class PlatformsController {
  constructor(
    private readonly oauth: PlatformOAuthRegistry,
    private readonly connections: PlatformConnectionStore,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  allStatus(@CurrentUser() user: AuthUser) {
    return this.connections.statusAll(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':provider/connect')
  connect(@Param('provider') provider: string, @CurrentUser() user: AuthUser) {
    return this.oauth.get(provider).buildConnectUrl(user.id);
  }

  /** Provider redirects here (no JWT). State carries the signed user id. */
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const redirectTo = await this.oauth.get(provider).handleCallback(code, state);
    return res.redirect(redirectTo);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':provider/status')
  status(@Param('provider') provider: string, @CurrentUser() user: AuthUser) {
    if (!isPlatformProvider(provider)) {
      throw new BadRequestException(`unknown platform ${provider}`);
    }
    return this.connections.status(user.id, provider);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':provider')
  disconnect(@Param('provider') provider: string, @CurrentUser() user: AuthUser) {
    if (!isPlatformProvider(provider)) {
      throw new BadRequestException(`unknown platform ${provider}`);
    }
    return this.connections.disconnect(user.id, provider);
  }
}
