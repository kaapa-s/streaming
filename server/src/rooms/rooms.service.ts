import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { issueJoinToken } from '@streaming/join-token';
import { Room, RoomMember, type RoomRole } from '../entities';
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

function optionalSfuUrl(): string | undefined {
  const value = process.env.SFU_PUBLIC_WS_URL?.trim();
  return value || undefined;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Room)
    private readonly rooms: Repository<Room>,
    @InjectRepository(RoomMember)
    private readonly members: Repository<RoomMember>,
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
          roomId: saved.id, userId: owner.id, role: 'owner',
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
    media: { status: string; startedAt: Date | null; endedAt: Date | null; file: string | null } | null;
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
          file: recording.filePath,
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
    room: { id: string; slug: string };
    role: RoomRole;
    joinToken: string;
    sfuUrl?: string;
  }> {
    const room = await this.findBySlug(slug);
    let member = await this.members.findOne({
      where: { roomId: room.id, userId: user.id },
    });
    if (!member) {
      member = await this.members.save(
        this.members.create({ roomId: room.id, userId: user.id, role: 'speaker' }),
      );
    }
    const role = member.role;

    const joinToken = issueJoinToken({
      roomSlug: room.slug,
      userId: user.id,
      name: user.name,
      role: 'speaker',
    });

    return {
      room: { id: room.id, slug: room.slug },
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
