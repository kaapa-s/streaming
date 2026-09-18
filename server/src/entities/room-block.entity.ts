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

/**
 * Room-scoped blocklist. A kicked user gets a row here keyed by their durable
 * account id, so neither the invite token nor the join link can re-admit them.
 */
@Entity('room_blocks')
@Unique(['roomId', 'userId'])
export class RoomBlock {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Index()
  @Column()
  declare roomId: string;

  @Index()
  @Column('uuid')
  declare userId: string;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  declare room: Room;

  @CreateDateColumn()
  declare createdAt: Date;
}
