import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from './auth.service';
import type { AuthUser } from './jwt.strategy';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<AuthUser> {
    try {
      const user = await this.auth.validateUser(email, password);
      return { id: user.id, email: user.email, name: user.name };
    } catch {
      throw new UnauthorizedException('invalid credentials');
    }
  }
}
