import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { GoLiveDto, SetOverlayDto, UploadDto, WarmupDto } from './dto';
import { SessionsService } from './sessions.service';

@Controller('internal')
@UseGuards(InternalSecretGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('health')
  health() {
    return this.sessions.health();
  }

  @Get('status')
  status() {
    return this.sessions.status();
  }

  @Post('rooms/:slug/warmup')
  warmup(@Param('slug') slug: string, @Body() body: WarmupDto) {
    return this.sessions.warmup(slug, body.token, body.resolution);
  }

  @Post('rooms/:slug/go-live')
  goLive(@Param('slug') slug: string, @Body() body: GoLiveDto) {
    return this.sessions.goLive(slug, {
      rtmpUrl: body.rtmpUrl,
      resolution: body.resolution,
      token: body.token,
    });
  }

  @Post('rooms/:slug/stop')
  stop(@Param('slug') slug: string) {
    return this.sessions.stop(slug);
  }

  @Post('rooms/:slug/upload')
  upload(@Param('slug') slug: string, @Body() body: UploadDto) {
    return this.sessions.upload(slug, body.putUrl);
  }

  @Post('rooms/:slug/overlay')
  setOverlay(@Param('slug') slug: string, @Body() body: SetOverlayDto) {
    return this.sessions.setOverlay(slug, body.overlay);
  }
}
