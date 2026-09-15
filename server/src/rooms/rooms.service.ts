import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { issueJoinToken } from '@streaming/join-token';
import { Room, RoomMember, User, type RoomRole } from '../entities';
import type { AuthUser } from '../auth/jwt.strategy';
import { randomRoomSlug } from './room-slug';

function optionalSfuUrl(): string | undefined {
  const value = process.env.SFU_PUBLIC_WS_URL?.trim();
  return value || undefined;
}

/** Postgres unique_violation — a slug collision on insert. */
const UNIQUE_VIOLATION = '23505';

export interface JoinResult {
  room: { id: string; slug: string; title: string; ownerId: string };
  role: RoomRole;
  joinToken: string;
  sfuUrl?: string;
}

export interface RoomDescription {
  slug: string;
  title: string;
  ownerName: string;
  closed: boolean;
  youAreOwner: boolean;
  youAreRemoved: boolean;
}

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly rooms: Repository<Room>,
    @InjectRepository(RoomMember)
    private readonly members: Repository<RoomMember>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** One room per stream. The slug is server-minted so the link stays unguessable. */
  async create(title: string, owner: AuthUser): Promise<Room> {
    const trimmed = title.trim();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const room = await this.rooms.save(
          this.rooms.create({
            slug: randomRoomSlug(),
            title: trimmed,
            ownerId: owner.id,
            closedAt: null,
          }),
        );
        await this.members.save(
          this.members.create({
            roomId: room.id,
            userId: owner.id,
            role: 'owner',
            removedAt: null,
            removedById: null,
          }),
        );
        return room;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new InternalServerErrorException('could not allocate a room slug');
  }

  async findBySlug(slug: string): Promise<Room> {
    const room = await this.rooms.findOne({ where: { slug: normalizeSlug(slug) } });
    if (!room) throw new NotFoundException(`room "${slug}" not found`);
    return room;
  }

  async findById(id: string): Promise<Room> {
    const room = await this.rooms.findOne({ where: { id } });
    if (!room) throw new NotFoundException('room not found');
    return room;
  }

  /** Room as seen from the pre-join screen. Knowing the slug is the only gate. */
  async describeForJoiner(slug: string, user: AuthUser): Promise<RoomDescription> {
    const room = await this.findBySlug(slug);
    const owner = await this.users.findOne({ where: { id: room.ownerId } });
    const member = await this.members.findOne({
      where: { roomId: room.id, userId: user.id },
    });
    return {
      slug: room.slug,
      title: room.title,
      ownerName: owner?.name ?? 'Unknown host',
      closed: room.closedAt != null,
      youAreOwner: room.ownerId === user.id,
      youAreRemoved: member?.removedAt != null,
    };
  }

  /**
   * Join by slug. Unknown slugs are 404 — this used to auto-create the room,
   * which made every typo a new room and every guessed slug a free speaker seat.
   */
  async joinBySlug(slug: string, user: AuthUser): Promise<JoinResult> {
    const room = await this.findBySlug(slug);
    if (room.closedAt != null) {
      throw new GoneException('this stream has ended');
    }

    let member = await this.members.findOne({
      where: { roomId: room.id, userId: user.id },
    });
    if (member?.removedAt != null) {
      throw new ForbiddenException('you were removed from this room');
    }
    if (!member) {
      member = await this.members.save(
        this.members.create({
          roomId: room.id,
          userId: user.id,
          role: 'speaker',
          removedAt: null,
          removedById: null,
        }),
      );
    }

    const joinToken = issueJoinToken({
      roomSlug: room.slug,
      userId: user.id,
      name: user.name,
      role: 'speaker',
      canManage: member.role === 'owner',
    });

    return {
      room: { id: room.id, slug: room.slug, title: room.title, ownerId: room.ownerId },
      role: member.role,
      joinToken,
      sfuUrl: optionalSfuUrl(),
    };
  }

  async requireMembership(roomId: string, userId: string): Promise<RoomMember> {
    const member = await this.members.findOne({ where: { roomId, userId } });
    if (!member) throw new ForbiddenException('not a member of this room');
    return member;
  }

  /**
   * Membership that is still valid: the member has not been removed and — unless
   * `allowClosed` — the room is still open. Teardown paths pass `allowClosed`
   * so stopping a recording still works after the room has been closed.
   */
  async requireActiveMembershipBySlug(
    slug: string,
    userId: string,
    opts: { allowClosed?: boolean } = {},
  ): Promise<{ room: Room; member: RoomMember }> {
    const room = await this.findBySlug(slug);
    if (room.closedAt != null && !opts.allowClosed) {
      throw new GoneException('this stream has ended');
    }
    const member = await this.requireMembership(room.id, userId);
    if (member.removedAt != null) {
      throw new ForbiddenException('you were removed from this room');
    }
    return { room, member };
  }

  async requireOwnerBySlug(
    slug: string,
    userId: string,
    opts: { allowClosed?: boolean } = {},
  ): Promise<{ room: Room; member: RoomMember }> {
    const result = await this.requireActiveMembershipBySlug(slug, userId, opts);
    if (result.member.role !== 'owner') {
      throw new ForbiddenException('only the room owner can do this');
    }
    return result;
  }

  /**
   * Kick, durable half. The SFU drop is immediate but only lasts as long as the
   * socket — without this row the kicked user re-POSTs /join and walks back in.
   */
  async removeMember(
    slug: string,
    targetUserId: string,
    actor: AuthUser,
  ): Promise<{ ok: true; userId: string }> {
    const { room } = await this.requireOwnerBySlug(slug, actor.id);
    if (targetUserId === actor.id) {
      throw new BadRequestException('the owner cannot remove themselves');
    }
    const member = await this.members.findOne({
      where: { roomId: room.id, userId: targetUserId },
    });
    if (!member) throw new NotFoundException('that person is not in this room');
    if (member.removedAt == null) {
      await this.members.update(member.id, {
        removedAt: new Date(),
        removedById: actor.id,
      });
    }
    return { ok: true, userId: targetUserId };
  }

  /** Marks the room closed. Teardown of recording/compositor lives in RecordingsService. */
  async close(slug: string, actor: AuthUser): Promise<Room> {
    const { room } = await this.requireOwnerBySlug(slug, actor.id, { allowClosed: true });
    if (room.closedAt == null) {
      const closedAt = new Date();
      await this.rooms.update(room.id, { closedAt });
      room.closedAt = closedAt;
    }
    return room;
  }

  /**
   * Ephemeral rooms that nobody ended (owner closed the tab). Closing them keeps
   * abandoned invite links from staying joinable forever; the compositor's own
   * idle reaper is what actually reclaims the browser slot.
   */
  async closeStaleRooms(olderThanHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const result = await this.rooms
      .createQueryBuilder()
      .update(Room)
      .set({ closedAt: () => 'now()' })
      .where('"closedAt" IS NULL AND "createdAt" < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  async listOpenSlugs(): Promise<string[]> {
    const rows = await this.rooms.find({
      where: { closedAt: IsNull() },
      select: { slug: true },
    });
    return rows.map((row) => row.slug);
  }

  /** Service token for the headless compositor (no end-user session). */
  issueCompositorJoinToken(roomSlug: string): string {
    return issueJoinToken(
      {
        roomSlug: normalizeSlug(roomSlug),
        userId: 'compositor',
        name: 'Recorder',
        role: 'compositor',
        // Recording sessions can run longer than a studio join.
      },
      60 * 60 * 6,
    );
  }
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
