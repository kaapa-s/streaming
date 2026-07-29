import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RefreshToken } from './refresh-token.entity';
import { Room } from './room.entity';
import { RoomMember } from './room-member.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Column({ unique: true })
  declare email: string;

  @Column()
  declare passwordHash: string;

  @Column()
  declare name: string;

  @CreateDateColumn()
  declare createdAt: Date;

  @OneToMany(() => RefreshToken, (token) => token.user)
  declare refreshTokens: RefreshToken[];

  @OneToMany(() => Room, (room) => room.owner)
  declare ownedRooms: Room[];

  @OneToMany(() => RoomMember, (member) => member.user)
  declare memberships: RoomMember[];
}
