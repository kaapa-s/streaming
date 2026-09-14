import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { envFirst } from './env';
import { jsonNumber, jsonString, oauthErrorMessage, oauthRedirect, parseOAuthJson } from './oauth-http';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { PlatformConnectionStore } from './platform-connection.store';

const SCOPES = 'instagram_business_basic';

@Injectable()
export class InstagramOAuthService {
  readonly provider = 'instagram' as const;
  private readonly logger = new Logger(InstagramOAuthService.name);

  constructor(private readonly connections: PlatformConnectionStore) {}

  private appId(): string {
    return envFirst(['INSTAGRAM_APP_ID', 'FACEBOOK_APP_ID'], 'INSTAGRAM_APP_ID or FACEBOOK_APP_ID');
  }

  private appSecret(): string {
    return envFirst(
      ['INSTAGRAM_APP_SECRET', 'FACEBOOK_APP_SECRET'],
      'INSTAGRAM_APP_SECRET or FACEBOOK_APP_SECRET',
    );
  }

  private redirectUri(): string {
    return envFirst(['INSTAGRAM_OAUTH_REDIRECT_URI'], 'INSTAGRAM_OAUTH_REDIRECT_URI');
  }

  buildConnectUrl(userId: string): { url: string } {
    const state = signOAuthState(userId, { provider: 'instagram' });
    const params = new URLSearchParams({
      client_id: this.appId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      state,
    });
    return { url: `https://www.instagram.com/oauth/authorize?${params.toString()}` };
  }

  async handleCallback(code: string | undefined, state: string | undefined): Promise<string> {
    try {
      if (!code || !state) throw new BadRequestException('missing code or state');
      const payload = verifyOAuthState(state);
      if (payload.provider && payload.provider !== 'instagram') {
        throw new BadRequestException('oauth state provider mismatch');
      }
      const shortLived = await this.exchangeCode(code);
      const longLived = await this.exchangeLongLived(shortLived.access_token);
      const account = await this.fetchProfile(longLived.access_token);
      await this.connections.upsert({
        userId: payload.userId,
        provider: 'instagram',
        externalAccountId: account.id,
        accountLabel: account.username,
        accessToken: longLived.access_token,
        expiresIn: longLived.expires_in,
        scopes: SCOPES,
      });
      return oauthRedirect('instagram', true);
    } catch (err) {
      this.logger.warn(`Instagram OAuth callback failed: ${String(err)}`);
      return oauthRedirect('instagram', false, oauthErrorMessage(err, 'Instagram connect failed'));
    }
  }

  private async exchangeCode(code: string): Promise<{ access_token: string }> {
    const body = new URLSearchParams({
      client_id: this.appId(),
      client_secret: this.appSecret(),
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri(),
      code,
    });
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
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
    return { access_token };
  }

  private async exchangeLongLived(
    shortLived: string,
  ): Promise<{ access_token: string; expires_in: number }> {
    const params = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: this.appSecret(),
      access_token: shortLived,
    });
    const res = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`);
    const data = await parseOAuthJson(res);
    const access_token = jsonString(data, 'access_token') ?? shortLived;
    const expires_in = jsonNumber(data, 'expires_in') ?? 60 * 24 * 3600;
    if (!res.ok && !jsonString(data, 'access_token')) {
      this.logger.warn('Instagram long-lived token exchange failed; storing short-lived token');
      return { access_token: shortLived, expires_in: 3600 };
    }
    return { access_token, expires_in };
  }

  private async fetchProfile(
    accessToken: string,
  ): Promise<{ id: string; username: string }> {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username,id&access_token=${encodeURIComponent(accessToken)}`,
    );
    const data = await parseOAuthJson(res);
    const id = jsonString(data, 'user_id') ?? jsonString(data, 'id');
    if (!res.ok || !id) {
      throw new BadRequestException(
        `Instagram profile failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return { id, username: jsonString(data, 'username') ?? 'Instagram' };
  }
}
