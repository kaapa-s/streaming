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

export type RecordingStatus =
  | 'starting'
  | 'recording'
  | 'uploading'
  | 'stopped'
  | 'failed';

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

  @Column({ type: 'varchar', nullable: true })
  declare filePath: string | null;

  @Column({ type: 'varchar', nullable: true })
  declare s3Key: string | null;

  @Column({ type: 'varchar', default: '720p' })
  declare resolution: string;

  @Column({ type: 'timestamptz', nullable: true })
  declare startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  declare endedAt: Date | null;

  @CreateDateColumn()
  declare createdAt: Date;
}
