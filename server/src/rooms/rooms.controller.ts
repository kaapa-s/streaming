import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { CompositorClient } from '../recordings/compositor.client';
import { RecordingsService } from '../recordings/recordings.service';
import { CreateRoomDto, SetLayoutDto } from './dto/rooms.dto';
import { RoomsService } from './rooms.service';

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
  async create(@Body() body: CreateRoomDto, @CurrentUser() user: AuthUser) {
    const room = await this.rooms.create(body.title, user);
    return { id: room.id, slug: room.slug, title: room.title };
  }

  /** Pre-join screen. Knowing the slug is the gate; membership is not required. */
  @Get(':slug')
  describe(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    return this.rooms.describeForJoiner(slug, user);
  }

  @Post(':slug/join')
  async join(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const result = await this.rooms.joinBySlug(slug, user);
    // Warm compositor Chromium, but only for the owner: the pool is fixed-size
    // and only the owner can start the recording, so a guest joining should
    // never be the thing that claims (or exhausts) a browser slot.
    if (result.role === 'owner') {
      this.recordings.warmupRoom(result.room.slug);
    }
    return result;
  }

  @Delete(':slug/members/:userId')
  removeMember(
    @Param('slug') slug: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rooms.removeMember(slug, userId, user);
  }

  /** Ends the stream: closes the room and tears down recording + compositor slot. */
  @Post(':slug/end')
  async end(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const room = await this.rooms.close(slug, user);
    const teardown = await this.recordings.endRoom(room);
    return { slug: room.slug, closedAt: room.closedAt, ...teardown };
  }

  @Post(':slug/layout')
  async setLayout(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SetLayoutDto,
  ) {
    await this.rooms.requireOwnerBySlug(slug, user.id);
    try {
      await this.compositor.setLayout(slug, {
        cameraPreset: body.cameraPreset,
        featuredId: body.featuredId,
        sceneScreenIds: body.sceneScreenIds,
      });
    } catch (err) {
      this.logger.warn(`compositor layout failed for ${slug}: ${String(err)}`);
    }
    return { ok: true };
  }
}
