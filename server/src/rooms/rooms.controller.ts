import { Body, Controller, Get, Inject, Logger, Param, Post, Req, UseGuards, forwardRef } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { CompositorClient } from '../recordings/compositor.client';
import { RecordingsService } from '../recordings/recordings.service';
import { postSfuInternal } from '../recordings/sfu-internal';
import { AdmitInviteDto, CreateRoomDto, SetLayoutDto } from './dto/rooms.dto';
import { RoomsService } from './rooms.service';
import type { RoomLayout } from './room-layout';

@Controller('rooms')
export class RoomsController {
  private readonly logger = new Logger(RoomsController.name);

  constructor(
    private readonly rooms: RoomsService,
    @Inject(forwardRef(() => RecordingsService))
    private readonly recordings: RecordingsService,
    private readonly compositor: CompositorClient,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: CreateRoomDto, @CurrentUser() user: AuthUser) {
    return this.rooms.create(body, user);
  }

  /** Authenticated owner dashboard data, including the latest recording state. */
  @Get()
  @UseGuards(JwtAuthGuard)
  listOwned(@CurrentUser() user: AuthUser) {
    return this.rooms.listOwned(user.id);
  }

  @Post('invite/admit')
  @UseGuards(OptionalJwtAuthGuard)
  admitInvite(@Body() body: AdmitInviteDto, @Req() req: Request & { user?: AuthUser }) {
    return this.rooms.admitInvite(body.token, req.user, body.displayName, body.guestId);
  }

  @Post(':slug/invites')
  @UseGuards(JwtAuthGuard)
  createInvite(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    return this.rooms.createInvite(slug, user.id);
  }

  @Post(':slug/discard')
  @UseGuards(JwtAuthGuard)
  async discard(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    return this.rooms.discard(slug, user.id, async () => {
      try {
        await this.compositor.discard(slug);
      } catch (err) {
        // The room is already deleted; cleanup can be retried by infrastructure
        // without turning a successful hard delete into a client retry loop.
        this.logger.warn(`discard compositor cleanup failed for ${slug}: ${String(err)}`);
      }
      try {
        await postSfuInternal(`/internal/rooms/${encodeURIComponent(slug)}/discard`);
      } catch (err) {
        this.logger.warn(`discard SFU cleanup failed for ${slug}: ${String(err)}`);
      }
    });
  }

  @Post(':slug/invites/:inviteId/revoke')
  @UseGuards(JwtAuthGuard)
  revokeInvite(@Param('inviteId') inviteId: string, @CurrentUser() user: AuthUser) {
    return this.rooms.revokeInvite(inviteId, user.id);
  }

  /** Resolve a room only for an existing member; slug lookup is not authorization. */
  @Get(':slug')
  @UseGuards(JwtAuthGuard)
  async getBySlug(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const { room, member } = await this.rooms.requireMembershipBySlug(slug, user.id);
    return { id: room.id, slug: room.slug, name: room.name, status: room.status, role: member.role };
  }

  @Get(':slug/members')
  @UseGuards(JwtAuthGuard)
  sceneMembers(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    return this.rooms.sceneMembers(slug, user.id);
  }

  @Post(':slug/members/:memberId/scene')
  @UseGuards(JwtAuthGuard)
  setSceneMembership(
    @Param('slug') slug: string,
    @Param('memberId') memberId: string,
    @Body() body: { inScene?: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.rooms.setSceneMembership(slug, user.id, memberId, body.inScene === true).then(async (result) => {
      if (!result.inScene) await this.disconnectFromSfu(slug, result.userId);
      return result;
    });
  }

  @Post(':slug/members/:memberId/kick')
  @UseGuards(JwtAuthGuard)
  async kickMember(@Param('slug') slug: string, @Param('memberId') memberId: string, @CurrentUser() user: AuthUser) {
    const result = await this.rooms.kickMember(slug, user.id, memberId);
    await this.disconnectFromSfu(slug, result.userId);
    return result;
  }

  private async disconnectFromSfu(slug: string, userId: string): Promise<void> {
    try {
      await postSfuInternal(`/internal/rooms/${encodeURIComponent(slug)}/kick`, { userId });
    } catch (err) {
      this.logger.warn(`SFU participant disconnect failed for ${slug}: ${String(err)}`);
    }
  }

  @Get(':slug/media')
  @UseGuards(JwtAuthGuard)
  async media(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const { room } = await this.rooms.requireMembershipBySlug(slug, user.id);
    return this.recordings.media(room, user.id);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
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
   * Current scene only. Kept for lightweight consumers; studios use `:slug/state`
   * for the scene plus participant and sharing state.
   */
  @Get(':slug/layout')
  @UseGuards(JwtAuthGuard)
  getLayout(@Param('slug') slug: string, @CurrentUser() user: AuthUser): Promise<RoomLayout> {
    return this.rooms.getLayout(slug, user.id);
  }

  /**
   * Authoritative room state for every connected studio: scene, participant
   * roster, and the member-visible sharing state. Members read it; the owner is
   * the only writer of the layout/sharing fields it reflects.
   */
  @Get(':slug/state')
  @UseGuards(JwtAuthGuard)
  async getState(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const [snapshot, sharing] = await Promise.all([
      this.rooms.roomSnapshot(slug, user.id),
      this.recordings.shareState(slug),
    ]);
    return { ...snapshot, sharing };
  }

  @Post(':slug/layout')
  @UseGuards(JwtAuthGuard)
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
