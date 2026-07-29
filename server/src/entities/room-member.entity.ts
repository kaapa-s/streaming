import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Room } from './room.entity';
import { User } from './user.entity';

export type RoomRole = 'owner' | 'speaker' | 'viewer';

@Entity('room_members')
@Unique(['roomId', 'userId'])
export class RoomMember {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Index()
  @Column()
  declare roomId: string;

  @Index()
  @Column()
  declare userId: string;

  @Column({ type: 'varchar' })
  declare role: RoomRole;

  @ManyToOne(() => Room, (room) => room.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  declare room: Room;

  @ManyToOne(() => User, (user) => user.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  declare user: User;

  @CreateDateColumn()
  declare createdAt: Date;
}
