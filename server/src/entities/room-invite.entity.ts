import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Room } from './room.entity';

@Entity('room_invites')
export class RoomInvite {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Index({ unique: true })
  @Column()
  declare tokenHash: string;

  /**
   * Raw token, stored so the canonical invite URL can be re-read by the owner.
   * Null for legacy hash-only invites, which must be regenerated to share.
   */
  @Index({ unique: true })
  @Column({ type: 'character varying', nullable: true })
  declare token: string | null;

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
