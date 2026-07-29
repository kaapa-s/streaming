import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  declare id: string;

  @Index()
  @Column()
  declare userId: string;

  @ManyToOne(() => User, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  declare user: User;

  @Column()
  declare tokenHash: string;

  @Column({ type: 'timestamptz' })
  declare expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  declare revokedAt: Date | null;

  @CreateDateColumn()
  declare createdAt: Date;
}
