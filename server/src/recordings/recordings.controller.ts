import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { RoomsService } from '../rooms/rooms.service';
import { RecordingsService } from './recordings.service';

@Controller('recordings')
@UseGuards(JwtAuthGuard)
export class RecordingsController {
  constructor(
    private readonly recordings: RecordingsService,
    private readonly rooms: RoomsService,
  ) {}

  @Post('start')
  async start(
    @CurrentUser() user: AuthUser,
    @Body() body: { room?: string; rtmpUrl?: string; resolution?: string },
  ) {
    const slug = body?.room ?? 'main';
    const { room } = await this.rooms.requireMembershipBySlug(slug, user.id);
    return this.recordings.start(room, body?.rtmpUrl, body?.resolution);
  }

  @Post('stop')
  async stop(
    @CurrentUser() user: AuthUser,
    @Body() body: { room?: string },
  ) {
    const slug = body?.room ?? 'main';
    const { room } = await this.rooms.requireMembershipBySlug(slug, user.id);
    return this.recordings.stop(room);
  }

  @Get()
  status() {
    return this.recordings.status();
  }
}
