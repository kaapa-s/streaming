import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { envFirst, requireEnv } from './env';
import { jsonNumber, jsonString, oauthErrorMessage, oauthRedirect, parseOAuthJson } from './oauth-http';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { PlatformConnectionStore } from './platform-connection.store';

const GRAPH = 'https://graph.facebook.com/v21.0';
const SCOPES = 'public_profile,email';

@Injectable()
export class FacebookOAuthService {
  readonly provider = 'facebook' as const;
  private readonly logger = new Logger(FacebookOAuthService.name);

  constructor(private readonly connections: PlatformConnectionStore) {}

  private appId(): string {
    return requireEnv('FACEBOOK_APP_ID');
  }

  private appSecret(): string {
    return requireEnv('FACEBOOK_APP_SECRET');
  }

  private redirectUri(): string {
    return envFirst(
      ['FACEBOOK_OAUTH_REDIRECT_URI'],
      'FACEBOOK_OAUTH_REDIRECT_URI',
    );
  }

  buildConnectUrl(userId: string): { url: string } {
    const state = signOAuthState(userId, { provider: 'facebook' });
    const params = new URLSearchParams({
      client_id: this.appId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      state,
    });
    return { url: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}` };
  }

  async handleCallback(code: string | undefined, state: string | undefined): Promise<string> {
    try {
      if (!code || !state) throw new BadRequestException('missing code or state');
      const payload = verifyOAuthState(state);
      if (payload.provider && payload.provider !== 'facebook') {
        throw new BadRequestException('oauth state provider mismatch');
      }
      const shortLived = await this.exchangeCode(code);
      const longLived = await this.exchangeLongLived(shortLived.access_token);
      const account = await this.fetchProfile(longLived.access_token);
      await this.connections.upsert({
        userId: payload.userId,
        provider: 'facebook',
        externalAccountId: account.id,
        accountLabel: account.name,
        accessToken: longLived.access_token,
        expiresIn: longLived.expires_in,
        scopes: SCOPES,
      });
      return oauthRedirect('facebook', true);
    } catch (err) {
      this.logger.warn(`Facebook OAuth callback failed: ${String(err)}`);
      return oauthRedirect('facebook', false, oauthErrorMessage(err, 'Facebook connect failed'));
    }
  }

  private async exchangeCode(code: string): Promise<{ access_token: string }> {
    const params = new URLSearchParams({
      client_id: this.appId(),
      client_secret: this.appSecret(),
      redirect_uri: this.redirectUri(),
      code,
    });
    const res = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`);
    const data = await parseOAuthJson(res);
    const access_token = jsonString(data, 'access_token');
    if (!res.ok || !access_token) {
      throw new BadRequestException(
        `token exchange failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return { access_token };
  }

  private async exchangeLongLived(
    shortLived: string,
  ): Promise<{ access_token: string; expires_in: number }> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId(),
      client_secret: this.appSecret(),
      fb_exchange_token: shortLived,
    });
    const res = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`);
    const data = await parseOAuthJson(res);
    const access_token = jsonString(data, 'access_token') ?? shortLived;
    const expires_in = jsonNumber(data, 'expires_in') ?? 60 * 24 * 3600;
    if (!res.ok && !jsonString(data, 'access_token')) {
      this.logger.warn(`Facebook long-lived token exchange failed; storing short-lived token`);
      return { access_token: shortLived, expires_in: 3600 };
    }
    return { access_token, expires_in };
  }

  private async fetchProfile(accessToken: string): Promise<{ id: string; name: string }> {
    const res = await fetch(`${GRAPH}/me?fields=id,name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await parseOAuthJson(res);
    const id = jsonString(data, 'id');
    if (!res.ok || !id) {
      throw new BadRequestException(
        `Facebook profile failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return { id, name: jsonString(data, 'name') ?? 'Facebook' };
  }
}
