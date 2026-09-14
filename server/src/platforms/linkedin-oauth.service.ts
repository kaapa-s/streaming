import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { requireEnv } from './env';
import { jsonNumber, jsonString, oauthErrorMessage, oauthRedirect, parseOAuthJson } from './oauth-http';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { PlatformConnectionStore } from './platform-connection.store';

const SCOPES = 'openid profile email';

@Injectable()
export class LinkedinOAuthService {
  readonly provider = 'linkedin' as const;
  private readonly logger = new Logger(LinkedinOAuthService.name);

  constructor(private readonly connections: PlatformConnectionStore) {}

  private clientId(): string {
    return requireEnv('LINKEDIN_CLIENT_ID');
  }

  private clientSecret(): string {
    return requireEnv('LINKEDIN_CLIENT_SECRET');
  }

  private redirectUri(): string {
    return requireEnv('LINKEDIN_OAUTH_REDIRECT_URI');
  }

  buildConnectUrl(userId: string): { url: string } {
    const state = signOAuthState(userId, { provider: 'linkedin' });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      state,
      scope: SCOPES,
    });
    return { url: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}` };
  }

  async handleCallback(code: string | undefined, state: string | undefined): Promise<string> {
    try {
      if (!code || !state) throw new BadRequestException('missing code or state');
      const payload = verifyOAuthState(state);
      if (payload.provider && payload.provider !== 'linkedin') {
        throw new BadRequestException('oauth state provider mismatch');
      }
      const tokens = await this.exchangeCode(code);
      const account = await this.fetchProfile(tokens.access_token);
      await this.connections.upsert({
        userId: payload.userId,
        provider: 'linkedin',
        externalAccountId: account.id,
        accountLabel: account.name,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scopes: tokens.scope ?? SCOPES,
      });
      return oauthRedirect('linkedin', true);
    } catch (err) {
      this.logger.warn(`LinkedIn OAuth callback failed: ${String(err)}`);
      return oauthRedirect('linkedin', false, oauthErrorMessage(err, 'LinkedIn connect failed'));
    }
  }

  private async exchangeCode(code: string): Promise<{
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
      client_secret: this.clientSecret(),
    });
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
      expires_in: jsonNumber(data, 'expires_in') ?? 3600,
      refresh_token: jsonString(data, 'refresh_token'),
      scope: jsonString(data, 'scope'),
    };
  }

  private async fetchProfile(accessToken: string): Promise<{ id: string; name: string }> {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await parseOAuthJson(res);
    const id = jsonString(data, 'sub');
    if (!res.ok || !id) {
      throw new BadRequestException(
        `LinkedIn profile failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return { id, name: jsonString(data, 'name') ?? jsonString(data, 'email') ?? 'LinkedIn' };
  }
}
