import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { issueJoinToken } from '@streaming/join-token';
import { Room, RoomMember, type RoomRole } from '../entities';
import type { AuthUser } from '../auth/jwt.strategy';

function optionalSfuUrl(): string | undefined {
  const value = process.env.SFU_PUBLIC_WS_URL?.trim();
  return value || undefined;
}

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly rooms: Repository<Room>,
    @InjectRepository(RoomMember)
    private readonly members: Repository<RoomMember>,
  ) {}

  async create(slug: string, owner: AuthUser): Promise<Room> {
    const normalized = slug.trim().toLowerCase();
    const existing = await this.rooms.findOne({ where: { slug: normalized } });
    if (existing) throw new ConflictException(`room "${normalized}" already exists`);
    const room = await this.rooms.save(
      this.rooms.create({ slug: normalized, ownerId: owner.id }),
    );
    await this.members.save(
      this.members.create({ roomId: room.id, userId: owner.id, role: 'owner' }),
    );
    return room;
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
   * Join by slug: create room (caller becomes owner) if missing, else ensure speaker membership.
   * Returns a short-lived SFU join token.
   */
  async joinBySlug(slug: string, user: AuthUser): Promise<{
    room: { id: string; slug: string };
    role: RoomRole;
    joinToken: string;
    sfuUrl?: string;
  }> {
    const normalized = slug.trim().toLowerCase();
    let room = await this.rooms.findOne({ where: { slug: normalized } });
    let role: RoomRole;

    if (!room) {
      room = await this.rooms.save(
        this.rooms.create({ slug: normalized, ownerId: user.id }),
      );
      await this.members.save(
        this.members.create({ roomId: room.id, userId: user.id, role: 'owner' }),
      );
      role = 'owner';
    } else {
      let member = await this.members.findOne({
        where: { roomId: room.id, userId: user.id },
      });
      if (!member) {
        member = await this.members.save(
          this.members.create({ roomId: room.id, userId: user.id, role: 'speaker' }),
        );
      }
      role = member.role;
    }

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
}
