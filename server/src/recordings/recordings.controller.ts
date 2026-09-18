import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
    const { room } = await this.rooms.requireMembershipBySlug(body.room, user.id);
    return this.recordings.start(room, user.id, body);
  }

  @Post('stop')
  async stop(@CurrentUser() user: AuthUser, @Body() body: StopRecordingDto) {
    const { room } = await this.rooms.requireMembershipBySlug(body.room, user.id);
    return this.recordings.stop(room, user.id);
  }

  /** Owner-only durable session state used to restore control after a reconnect. */
  @Get('session')
  async session(@CurrentUser() user: AuthUser, @Query('room') room?: string) {
    if (!room?.trim()) throw new BadRequestException('room is required');
    const { room: resolved } = await this.rooms.requireMembershipBySlug(room, user.id);
    return this.recordings.session(resolved, user.id);
  }

  @Get()
  status() {
    return this.recordings.status();
  }
}
