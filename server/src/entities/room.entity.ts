import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Recording } from './recording.entity';
import { RoomMember } from './room-member.entity';
import { User } from './user.entity';

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  /** Server-minted random hex (see rooms/room-slug.ts). The link is the secret. */
  @Column({ unique: true })
  declare slug: string;

  /** Human name for the stream. Shown in the UI; never used as an identifier. */
  @Column({ default: '' })
  declare title: string;

  @Column()
  declare ownerId: string;

  /**
   * Rooms are ephemeral: set when the owner ends the stream, after which the
   * invite link stops working. Sole source of truth for open/closed — a
   * separate `status` column could only drift from this one.
   */
  @Column({ type: 'timestamptz', nullable: true })
  declare closedAt: Date | null;

  @ManyToOne(() => User, (user) => user.ownedRooms, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  declare owner: User;

  @CreateDateColumn()
  declare createdAt: Date;

  @OneToMany(() => RoomMember, (member) => member.room)
  declare members: RoomMember[];

  @OneToMany(() => Recording, (recording) => recording.room)
  declare recordings: Recording[];
}
