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

  @Column({ unique: true })
  declare slug: string;

  @Column()
  declare ownerId: string;

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
