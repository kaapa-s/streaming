import {
  Controller,
  Delete,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { YoutubeOAuthService } from './youtube-oauth.service';

@Controller('platforms/youtube')
export class PlatformsController {
  constructor(private readonly youtube: YoutubeOAuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('connect')
  connect(@CurrentUser() user: AuthUser) {
    return this.youtube.buildConnectUrl(user.id);
  }

  /** Google redirects here (no JWT). State carries the signed user id. */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const redirectTo = await this.youtube.handleCallback(code, state);
    return res.redirect(redirectTo);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.youtube.status(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  disconnect(@CurrentUser() user: AuthUser) {
    return this.youtube.disconnect(user.id);
  }
}
