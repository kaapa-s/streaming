import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Room } from './room.entity';
import type { PlatformProvider } from '../platforms/platform-ids';

/**
 * Durable session lifecycle. A recording row is the source of truth for an
 * active room session: it survives API restarts and owner disconnects, and only
 * an explicit stop moves it toward `finished` (or `failed`).
 */
export type RecordingStatus =
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'uploading'
  | 'finished'
  | 'failed';

/** Statuses that mean a media session is still owned by the room. */
export const ACTIVE_RECORDING_STATUSES: RecordingStatus[] = [
  'starting',
  'recording',
  'stopping',
  'uploading',
];

@Entity('recordings')
export class Recording {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Index()
  @Column()
  declare roomId: string;

  @ManyToOne(() => Room, (room) => room.recordings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  declare room: Room;

  @Column({ type: 'varchar', default: 'starting' })
  declare status: RecordingStatus;

  /** True when the session also fans out to RTMP destinations (go live). */
  @Column({ type: 'boolean', default: false })
  declare live: boolean;

  /** RTMP destinations chosen at go-live, kept so control survives a reconnect. */
  @Column({ type: 'jsonb', nullable: true })
  declare destinations: PlatformProvider[] | null;

  /** Human-readable failure for a failed start/stop/upload. */
  @Column({ type: 'varchar', nullable: true })
  declare error: string | null;

  @Column({ type: 'varchar', nullable: true })
  declare filePath: string | null;

  @Column({ type: 'varchar', nullable: true })
  declare s3Key: string | null;

  @Column({ type: 'varchar', default: '1080p' })
  declare resolution: string;

  @Column({ type: 'timestamptz', nullable: true })
  declare startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  declare endedAt: Date | null;

  @CreateDateColumn()
  declare createdAt: Date;
}
