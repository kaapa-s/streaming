import {
  Column,
  CreateDateColumn,
  Index,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Recording } from './recording.entity';
import { RoomMember } from './room-member.entity';
import { User } from './user.entity';
import type { RoomLayout } from '../rooms/room-layout';

export type RoomStatus = 'created' | 'active' | 'finished';

@Entity('rooms')
@Index('IDX_rooms_one_active_owner', ['ownerId'], {
  unique: true,
  where: '"status" = \'active\'',
})
export class Room {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Column({ unique: true })
  declare slug: string;

  @Column({ type: 'varchar' })
  declare name: string;

  @Column()
  declare ownerId: string;

  @Column({ type: 'varchar', default: 'created' })
  declare status: RoomStatus;

  @ManyToOne(() => User, (user) => user.ownedRooms, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  declare owner: User;

  /**
   * Last scene the owner picked. Null until they change anything; the API falls
   * back to DEFAULT_ROOM_LAYOUT so late-joining speakers still mirror a real scene.
   */
  @Column({ type: 'jsonb', nullable: true })
  declare layout: RoomLayout | null;

  @CreateDateColumn()
  declare createdAt: Date;

  @OneToMany(() => RoomMember, (member) => member.room)
  declare members: RoomMember[];

  @OneToMany(() => Recording, (recording) => recording.room)
  declare recordings: Recording[];
}
