import { Body, Controller, Get, Inject, Logger, Param, Post, UseGuards, forwardRef } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { CompositorClient } from '../recordings/compositor.client';
import { RecordingsService } from '../recordings/recordings.service';
import { CreateRoomDto, SetLayoutDto } from './dto/rooms.dto';
import { RoomsService } from './rooms.service';
import type { RoomLayout } from './room-layout';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  private readonly logger = new Logger(RoomsController.name);

  constructor(
    private readonly rooms: RoomsService,
    @Inject(forwardRef(() => RecordingsService))
    private readonly recordings: RecordingsService,
    private readonly compositor: CompositorClient,
  ) {}

  @Post()
  create(@Body() body: CreateRoomDto, @CurrentUser() user: AuthUser) {
    return this.rooms.create(body.slug, user);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.rooms.findBySlug(slug);
  }

  @Post(':id/join')
  async joinById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    // UUID → by id; otherwise treat as a room slug for studio UX (?room=<slug>).
    const result = isUuid(id)
      ? await this.rooms.joinById(id, user)
      : await this.rooms.joinBySlug(id, user);
    // Warm compositor Chromium for this room (idle SFU join, no recording yet).
    this.recordings.warmupRoom(result.room.slug);
    return result;
  }

  /**
   * Current scene. Non-owner speakers poll this so their program preview follows
   * whatever the owner last put on air.
   */
  @Get(':slug/layout')
  getLayout(@Param('slug') slug: string, @CurrentUser() user: AuthUser): Promise<RoomLayout> {
    return this.rooms.getLayout(slug, user.id);
  }

  @Post(':slug/layout')
  async setLayout(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SetLayoutDto,
  ): Promise<{ ok: true }> {
    // Owner-only; also persists so later joiners mirror the same scene.
    const layout = await this.rooms.setLayout(slug, user.id, body);
    try {
      await this.compositor.setLayout(slug, layout);
    } catch (err) {
      // The recorder being unreachable must not break the studio, and other
      // speakers still follow the stored layout.
      this.logger.warn(`compositor layout failed for ${slug}: ${String(err)}`);
    }
    return { ok: true };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
