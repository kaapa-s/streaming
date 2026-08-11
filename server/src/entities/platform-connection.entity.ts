import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export type PlatformProvider = 'youtube';

@Entity('platform_connections')
@Unique(['userId', 'provider'])
export class PlatformConnection {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Index()
  @Column()
  declare userId: string;

  @Column({ type: 'varchar' })
  declare provider: PlatformProvider;

  @Column()
  declare externalAccountId: string;

  @Column({ type: 'varchar', nullable: true })
  declare accountLabel: string | null;

  /** AES-GCM ciphertext (base64). */
  @Column({ type: 'text' })
  declare accessTokenEnc: string;

  /** AES-GCM ciphertext (base64); null if Google did not return a refresh token. */
  @Column({ type: 'text', nullable: true })
  declare refreshTokenEnc: string | null;

  @Column({ type: 'timestamptz' })
  declare expiresAt: Date;

  @Column({ type: 'text' })
  declare scopes: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  declare user: User;

  @CreateDateColumn()
  declare createdAt: Date;

  @UpdateDateColumn()
  declare updatedAt: Date;
}
