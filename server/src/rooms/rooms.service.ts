import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { issueJoinToken } from '@streaming/join-token';
import { Recording, Room, RoomInvite, RoomMember, type RoomRole } from '../entities';
import type { AuthUser } from '../auth/jwt.strategy';
import {
  defaultRoomLayout,
  normalizeRoomLayout,
  type RoomLayout,
} from './room-layout';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function roomLayoutOf(room: Room): RoomLayout {
  // normalizeRoomLayout guards legacy/hand-edited jsonb rows; defaultRoomLayout is fresh.
  return room.layout ? normalizeRoomLayout(room.layout) : defaultRoomLayout();
}

function slugify(value: string): string {
  const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'room';
}

function hashInvite(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

function optionalSfuUrl(): string | undefined {
  const value = process.env.SFU_PUBLIC_WS_URL?.trim();
  return value || undefined;
}

export interface RoomParticipant {
  id: string;
  userId: string | null;
  guestId: string | null;
  displayName: string | null;
  role: RoomRole;
  inScene: boolean;
}

/** Authoritative, member-scoped room state every studio can converge on. */
export interface RoomSnapshot {
  room: { id: string; slug: string; name: string; status: Room['status'] };
  role: RoomRole;
  layout: RoomLayout;
  participants: RoomParticipant[];
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Room)
    private readonly rooms: Repository<Room>,
    @InjectRepository(RoomMember)
    private readonly members: Repository<RoomMember>,
    @InjectRepository(RoomInvite)
    private readonly invites: Repository<RoomInvite>,
  ) {}

  async create(input: { name?: string; slug?: string }, owner: AuthUser): Promise<Room> {
    const current = await this.rooms.findOne({ where: { ownerId: owner.id, status: 'created' } });
    const active = current ?? await this.rooms.findOne({ where: { ownerId: owner.id, status: 'active' } });
    if (active) throw new ConflictException(`user already owns a current room: ${active.slug}`);
    const name = input.name?.trim() || input.slug?.trim();
    if (!name) throw new BadRequestException('room name is required');
    const base = input.slug?.trim().toLowerCase() || slugify(name);
    let slug = base;
    for (let suffix = 2; suffix < 10000; suffix += 1) {
      const existing = await this.rooms.findOne({ where: { slug } });
      if (!existing) break;
      slug = `${base}-${suffix}`;
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const room = manager.create(Room, { name, slug, ownerId: owner.id, status: 'created' });
        const saved = await manager.save(Room, room);
        await manager.save(RoomMember, manager.create(RoomMember, {
          roomId: saved.id, userId: owner.id, role: 'owner', inScene: true,
        }));
        return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.rooms.findOne({ where: { ownerId: owner.id, status: 'created' } });
        throw new ConflictException(`user already owns a current room${existing ? `: ${existing.slug}` : ''}`);
      }
      throw error;
    }
  }

  async listOwned(userId: string): Promise<Array<{
    id: string; slug: string; name: string; status: Room['status']; createdAt: Date;
    media: { status: string; startedAt: Date | null; endedAt: Date | null; error: string | null; file: string | null } | null;
  }>> {
    const rooms = await this.rooms.find({
      where: { ownerId: userId },
      relations: { recordings: true },
      order: { createdAt: 'DESC' },
    });
    return rooms.map((room) => {
      const recording = [...(room.recordings ?? [])].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];
      return {
        id: room.id, slug: room.slug, name: room.name, status: room.status,
        createdAt: room.createdAt,
        media: recording ? {
          status: recording.status, startedAt: recording.startedAt, endedAt: recording.endedAt,
          error: recording.error, file: recording.filePath,
        } : null,
      };
    });
  }

  async activeOwnedBy(userId: string): Promise<Room | null> {
    return this.rooms.findOne({ where: { ownerId: userId, status: In(['created', 'active']) } });
  }

  async findBySlug(slug: string): Promise<Room> {
    const room = await this.rooms.findOne({ where: { slug: slug.trim().toLowerCase() } });
    if (!room) throw new NotFoundException(`room "${slug}" not found`);
    return room;
  }

  async findById(id: string): Promise<Room> {
    const room = await this.rooms.findOne({ where: { id } });
    if (!room) throw new NotFoundException('room not found');
    return room;
  }

  /** Hard-delete a never-started room. The row lock makes discard/join races deterministic. */
  async discard(slug: string, ownerId: string, cleanup: () => Promise<void>): Promise<{ ok: true }> {
    let deletedSlug: string | undefined;
    await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(Room, {
        where: { slug: slug.trim().toLowerCase() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!room) throw new NotFoundException(`room "${slug}" not found`);
      if (room.ownerId !== ownerId) throw new ForbiddenException('only the room owner can discard this room');
      if (room.status !== 'created') {
        throw new ConflictException(`room "${room.slug}" cannot be discarded from status "${room.status}"`);
      }
      const attempts = await manager.count(Recording, { where: { roomId: room.id } });
      if (attempts > 0) throw new ConflictException(`room "${room.slug}" has a recording attempt`);
      await manager.remove(Room, room);
      deletedSlug = room.slug;
    });

    // Cleanup is deliberately after commit: a compositor outage must not leave a
    // database room that blocks the owner's replacement slot. It is idempotent.
    if (deletedSlug) await cleanup();
    return { ok: true };
  }

  async requireMembership(roomId: string, userId: string): Promise<RoomMember> {
    const member = await this.members.findOne({ where: { roomId, userId } });
    if (!member) throw new ForbiddenException('not a member of this room');
    return member;
  }

  async requireMembershipBySlug(slug: string, userId: string): Promise<{ room: Room; member: RoomMember }> {
    const room = await this.findBySlug(slug);
    const member = await this.requireMembership(room.id, userId);
    return { room, member };
  }

  /**
   * Join an existing room by slug and ensure speaker membership.
   * Rooms are created explicitly through POST /rooms, never as a join side effect.
   */
  async joinBySlug(slug: string, user: AuthUser): Promise<{
    room: { id: string; slug: string; name: string; status: Room['status'] };
    role: RoomRole;
    joinToken: string;
    sfuUrl?: string;
  }> {
    const room = await this.findBySlug(slug);
    if (room.status === 'finished') throw new ForbiddenException('room is finished');
    let member = await this.members.findOne({ where: { roomId: room.id, userId: user.id } });
    if (!member) throw new ForbiddenException('an invite is required to join this room');
    if (!member.inScene) throw new ForbiddenException('the owner has not admitted you to the scene');
    const role = member.role;

    const joinToken = issueJoinToken({
      roomSlug: room.slug,
      userId: user.id,
      name: user.name,
      role: 'speaker',
      inScene: true,
      canManage: member.role === 'owner',
    });

    return {
      room: { id: room.id, slug: room.slug, name: room.name, status: room.status },
      role,
      joinToken,
      sfuUrl: optionalSfuUrl(),
    };
  }

  async joinById(roomId: string, user: AuthUser): Promise<{
    room: { id: string; slug: string };
    role: RoomRole;
    joinToken: string;
    sfuUrl?: string;
  }> {
    const room = await this.findById(roomId);
    return this.joinBySlug(room.slug, user);
  }

  async createInvite(slug: string, ownerId: string): Promise<{ id: string; token: string; url: string }> {
    const room = await this.findBySlug(slug);
    if (room.ownerId !== ownerId) throw new ForbiddenException('only the room owner can manage invites');
    if (room.status === 'finished') throw new ForbiddenException('room is finished');
    const token = randomBytes(32).toString('base64url');
    const invite = await this.invites.save(
      this.invites.create({ roomId: room.id, tokenHash: hashInvite(token), revokedAt: null }),
    );
    const base = process.env.WEB_PUBLIC_URL?.replace(/\/$/, '') ?? '';
    return { id: invite.id, token, url: `${base}/join?invite=${encodeURIComponent(token)}` };
  }

  /**
   * Owner-facing invite metadata. Deliberately selects only non-secret columns so
   * a stored token hash can never leak through the list surface.
   */
  async listInvites(
    slug: string,
    ownerId: string,
  ): Promise<Array<{ id: string; createdAt: Date; revokedAt: Date | null }>> {
    const room = await this.findBySlug(slug);
    if (room.ownerId !== ownerId) throw new ForbiddenException('only the room owner can manage invites');
    const invites = await this.invites.find({
      where: { roomId: room.id },
      order: { createdAt: 'DESC' },
      select: { id: true, createdAt: true, revokedAt: true },
    });
    return invites.map(({ id, createdAt, revokedAt }) => ({ id, createdAt, revokedAt }));
  }

  async revokeInvite(id: string, ownerId: string): Promise<{ ok: true }> {
    const invite = await this.invites.findOne({ where: { id }, relations: { room: true } });
    if (!invite) throw new NotFoundException('invite not found');
    if (invite.room.ownerId !== ownerId) throw new ForbiddenException('only the room owner can manage invites');
    await this.invites.update({ id }, { revokedAt: new Date() });
    return { ok: true };
  }

  async admitInvite(token: string, user: AuthUser | undefined, displayName?: string, guestId?: string) {
    const invite = await this.invites.findOne({ where: { tokenHash: hashInvite(token) }, relations: { room: true } });
    if (!invite || invite.revokedAt || invite.room.status === 'finished') throw new ForbiddenException('invalid or unavailable invite');
    const room = invite.room;
    let member = user
      ? await this.members.findOne({ where: { roomId: room.id, userId: user.id } })
      : guestId ? await this.members.findOne({ where: { roomId: room.id, guestId } }) : null;
    if (!member) {
      const name = user?.name?.trim() || displayName?.trim();
      if (!name) throw new BadRequestException('display name is required for guests');
      const count = await this.members.count({ where: { roomId: room.id } });
      if (count >= 15) throw new ConflictException('room is full');
      const identity = user ? { userId: user.id, guestId: null } : { userId: null, guestId: guestId || randomUUID() };
      // Invitees start off-scene and consume no scene slot until the owner admits them.
      member = await this.members.save(this.members.create({ roomId: room.id, ...identity, displayName: name, role: 'speaker', inScene: false }));
    }
    const identity = user ? user.id : `guest:${member.guestId}`;
    const name = user?.name || member.displayName || 'Guest';
    // A waiting member gets no SFU token: off-scene clients must not connect
    // until the owner admits them and joinBySlug authorizes the join.
    return {
      room: { id: room.id, slug: room.slug },
      role: member.role,
      guestId: member.guestId,
      inScene: member.inScene,
      ...(member.inScene
        ? {
          joinToken: issueJoinToken({ roomSlug: room.slug, userId: identity, name, role: 'speaker', inScene: true, canManage: member.role === 'owner' }),
          sfuUrl: optionalSfuUrl(),
        }
        : {}),
    };
  }

  async sceneMembers(slug: string, ownerId: string) {
    const { room } = await this.requireMembershipBySlug(slug, ownerId);
    return this.members.find({ where: { roomId: room.id }, order: { createdAt: 'ASC' } });
  }

  /**
   * Everything a connected studio needs to converge: the authoritative scene,
   * the room identity, and the participant roster (including off-scene members
   * who are waiting for admission). Any member may read it; only the owner can
   * change the layout or scene membership.
   */
  async roomSnapshot(slug: string, userId: string): Promise<RoomSnapshot> {
    const { room, member } = await this.requireMembershipBySlug(slug, userId);
    const participants = await this.members.find({
      where: { roomId: room.id },
      order: { createdAt: 'ASC' },
    });
    return {
      room: { id: room.id, slug: room.slug, name: room.name, status: room.status },
      role: member.role,
      layout: roomLayoutOf(room),
      participants: participants.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        guestId: entry.guestId,
        displayName: entry.displayName,
        role: entry.role,
        inScene: entry.inScene,
      })),
    };
  }

  async setSceneMembership(slug: string, ownerId: string, memberId: string, inScene: boolean) {
    const { room, member } = await this.requireMembershipBySlug(slug, ownerId);
    if (member.role !== 'owner') throw new ForbiddenException('only the room owner can change scene membership');
    const target = await this.members.findOne({ where: { id: memberId, roomId: room.id } });
    if (!target) throw new NotFoundException('room member not found');
    if (target.role === 'owner' && !inScene) throw new ForbiddenException('the owner must remain in the scene');
    const result = await this.dataSource.transaction(async (manager) => {
      const lockedRoom = await manager.findOne(Room, {
        where: { id: room.id }, lock: { mode: 'pessimistic_write' },
      });
      if (!lockedRoom) throw new NotFoundException('room not found');
      const lockedTarget = await manager.findOne(RoomMember, { where: { id: target.id, roomId: room.id } });
      if (!lockedTarget) throw new NotFoundException('room member not found');
      if (inScene && !lockedTarget.inScene) {
        const count = await manager.count(RoomMember, { where: { roomId: room.id, inScene: true } });
        if (count >= 10) throw new ConflictException('scene is full');
      }
      await manager.update(RoomMember, { id: lockedTarget.id }, { inScene });
      return { id: lockedTarget.id, userId: lockedTarget.userId ?? `guest:${lockedTarget.guestId}`, inScene };
    });
    return result;
  }

  async kickMember(slug: string, ownerId: string, memberId: string) {
    const { room, member } = await this.requireMembershipBySlug(slug, ownerId);
    if (member.role !== 'owner') throw new ForbiddenException('only the room owner can kick members');
    const target = await this.members.findOne({ where: { id: memberId, roomId: room.id } });
    if (!target) throw new NotFoundException('room member not found');
    if (target.role === 'owner') throw new ForbiddenException('the owner cannot be kicked');
    await this.members.remove(target);
    return { ok: true, userId: target.userId ?? `guest:${target.guestId}` };
  }

  /** Service token for the headless compositor (no end-user session). */
  issueCompositorJoinToken(roomSlug: string): string {
    return issueJoinToken({
      roomSlug: roomSlug.trim().toLowerCase(),
      userId: 'compositor',
      name: 'Recorder',
      role: 'compositor',
      // Recording sessions can run longer than a studio join.
    }, 60 * 60 * 6);
  }

  /** Stored scene for a room, without a membership check (internal/compositor use). */
  async layoutBySlug(slug: string): Promise<RoomLayout> {
    const room = await this.findBySlug(slug);
    return roomLayoutOf(room);
  }

  /** Stored scene for a room. Any member may read it — everyone mirrors the owner. */
  async getLayout(slug: string, userId: string): Promise<RoomLayout> {
    const { room } = await this.requireMembershipBySlug(slug, userId);
    return roomLayoutOf(room);
  }

  /** Persist the owner's scene. Returns the normalized layout for the caller to forward. */
  async setLayout(slug: string, userId: string, layout: unknown): Promise<RoomLayout> {
    const { room, member } = await this.requireMembershipBySlug(slug, userId);
    if (member.role !== 'owner') {
      throw new ForbiddenException('only the room owner can change layout');
    }
    const next = normalizeRoomLayout(layout);
    await this.rooms.update({ id: room.id }, { layout: next });
    return next;
  }
}
