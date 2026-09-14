import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { RoomsService } from '../rooms/rooms.service';
import { StartRecordingDto, StopRecordingDto } from './recordings.dto';
import { RecordingsService } from './recordings.service';

@Controller('recordings')
@UseGuards(JwtAuthGuard)
export class RecordingsController {
  constructor(
    private readonly recordings: RecordingsService,
    private readonly rooms: RoomsService,
  ) {}

  @Post('start')
  async start(@CurrentUser() user: AuthUser, @Body() body: StartRecordingDto) {
    const slug = body.room ?? 'main';
    const { room } = await this.rooms.requireMembershipBySlug(slug, user.id);
    return this.recordings.start(room, user.id, body);
  }

  @Post('stop')
  async stop(@CurrentUser() user: AuthUser, @Body() body: StopRecordingDto) {
    const slug = body.room ?? 'main';
    const { room } = await this.rooms.requireMembershipBySlug(slug, user.id);
    return this.recordings.stop(room);
  }

  @Get()
  status() {
    return this.recordings.status();
  }
}
