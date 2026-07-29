import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { RefreshToken, User } from '../entities';
import { UsersService } from '../users/users.service';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  async register(email: string, password: string, name: string): Promise<AuthTokens> {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new ConflictException('email already registered');
    const passwordHash = await argon2.hash(password);
    const user = await this.users.create(email, passwordHash, name.trim());
    return this.issueSession(user);
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('invalid credentials');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    return user;
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.validateUser(email, password);
    return this.issueSession(user);
  }

  /** After LocalAuthGuard has already validated credentials. */
  async loginUser(userId: string): Promise<AuthTokens> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('invalid credentials');
    return this.issueSession(user);
  }

  async refresh(rawToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash },
      relations: ['user'],
    });
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('invalid refresh token');
    }
    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);
    return this.issueSession(stored.user);
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash } });
    if (!stored || stored.revokedAt) return;
    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);
  }

  private async issueSession(user: User): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, name: user.name },
      { expiresIn: ACCESS_TTL },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        revokedAt: null,
      }),
    );
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
