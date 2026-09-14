import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { requireEnv } from './env';
import { jsonNumber, jsonString, oauthErrorMessage, oauthRedirect, parseOAuthJson } from './oauth-http';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { PlatformConnectionStore } from './platform-connection.store';

const SCOPES = 'tweet.read users.read offline.access';

function pkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

@Injectable()
export class XOAuthService {
  readonly provider = 'x' as const;
  private readonly logger = new Logger(XOAuthService.name);

  constructor(private readonly connections: PlatformConnectionStore) {}

  private clientId(): string {
    return requireEnv('X_CLIENT_ID');
  }

  private clientSecret(): string {
    return requireEnv('X_CLIENT_SECRET');
  }

  private redirectUri(): string {
    return requireEnv('X_OAUTH_REDIRECT_URI');
  }

  buildConnectUrl(userId: string): { url: string } {
    const codeVerifier = pkceVerifier();
    const state = signOAuthState(userId, { provider: 'x', codeVerifier });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      scope: SCOPES,
      state,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });
    return { url: `https://x.com/i/oauth2/authorize?${params.toString()}` };
  }

  async handleCallback(code: string | undefined, state: string | undefined): Promise<string> {
    try {
      if (!code || !state) throw new BadRequestException('missing code or state');
      const payload = verifyOAuthState(state);
      if (payload.provider && payload.provider !== 'x') {
        throw new BadRequestException('oauth state provider mismatch');
      }
      if (!payload.codeVerifier) {
        throw new BadRequestException('oauth state missing PKCE verifier');
      }
      const tokens = await this.exchangeCode(code, payload.codeVerifier);
      const account = await this.fetchProfile(tokens.access_token);
      await this.connections.upsert({
        userId: payload.userId,
        provider: 'x',
        externalAccountId: account.id,
        accountLabel: account.username,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scopes: tokens.scope ?? SCOPES,
      });
      return oauthRedirect('x', true);
    } catch (err) {
      this.logger.warn(`X OAuth callback failed: ${String(err)}`);
      return oauthRedirect('x', false, oauthErrorMessage(err, 'X connect failed'));
    }
  }

  private async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(),
      client_id: this.clientId(),
      code_verifier: codeVerifier,
    });
    const basic = Buffer.from(`${this.clientId()}:${this.clientSecret()}`).toString('base64');
    const res = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body,
    });
    const data = await parseOAuthJson(res);
    const access_token = jsonString(data, 'access_token');
    if (!res.ok || !access_token) {
      throw new BadRequestException(
        `token exchange failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return {
      access_token,
      expires_in: jsonNumber(data, 'expires_in') ?? 7200,
      refresh_token: jsonString(data, 'refresh_token'),
      scope: jsonString(data, 'scope'),
    };
  }

  private async fetchProfile(
    accessToken: string,
  ): Promise<{ id: string; username: string }> {
    const res = await fetch('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await parseOAuthJson(res);
    const nested = data.data;
    const profile =
      typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : data;
    const id = jsonString(profile, 'id');
    if (!res.ok || !id) {
      throw new BadRequestException(
        `X profile failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return { id, username: jsonString(profile, 'username') ?? jsonString(profile, 'name') ?? 'X' };
  }
}
