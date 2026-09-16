import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Room } from './room.entity';

@Entity('room_invites')
export class RoomInvite {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Index({ unique: true })
  @Column()
  declare tokenHash: string;

  @Index()
  @Column()
  declare roomId: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  declare revokedAt: Date | null;

  @CreateDateColumn()
  declare createdAt: Date;

  @ManyToOne(() => Room, (room) => room.invites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  declare room: Room;
}
