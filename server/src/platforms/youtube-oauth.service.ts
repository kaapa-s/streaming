import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlatformConnectionStore } from './platform-connection.store';
import { oauthErrorMessage, oauthRedirect, parseOAuthJson, jsonString } from './oauth-http';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { requireEnv } from './env';
import { encryptSecret } from './token-crypto';

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email',
].join(' ');

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

interface ChannelSnippet {
  items?: Array<{
    id: string;
    snippet?: { title?: string };
  }>;
}

@Injectable()
export class YoutubeOAuthService {
  readonly provider = 'youtube' as const;
  private readonly logger = new Logger(YoutubeOAuthService.name);

  constructor(private readonly connections: PlatformConnectionStore) {}

  private clientId(): string {
    return requireEnv('GOOGLE_CLIENT_ID');
  }

  private clientSecret(): string {
    return requireEnv('GOOGLE_CLIENT_SECRET');
  }

  private redirectUri(): string {
    return requireEnv('GOOGLE_OAUTH_REDIRECT_URI');
  }

  buildConnectUrl(userId: string): { url: string } {
    const state = signOAuthState(userId, { provider: 'youtube' });
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: YOUTUBE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  async handleCallback(code: string | undefined, state: string | undefined): Promise<string> {
    try {
      if (!code || !state) throw new BadRequestException('missing code or state');
      const payload = verifyOAuthState(state);
      if (payload.provider && payload.provider !== 'youtube') {
        throw new BadRequestException('oauth state provider mismatch');
      }
      const tokens = await this.exchangeCode(code);
      const channel = await this.fetchChannel(tokens.access_token);
      await this.connections.upsert({
        userId: payload.userId,
        provider: 'youtube',
        externalAccountId: channel.id,
        accountLabel: channel.title,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scopes: tokens.scope ?? YOUTUBE_SCOPES,
      });
      return oauthRedirect('youtube', true);
    } catch (err) {
      this.logger.warn(`YouTube OAuth callback failed: ${String(err)}`);
      return oauthRedirect('youtube', false, oauthErrorMessage(err, 'YouTube connect failed'));
    }
  }

  status(userId: string) {
    return this.connections.status(userId, 'youtube');
  }

  disconnect(userId: string) {
    return this.connections.disconnect(userId, 'youtube');
  }

  async getValidAccessToken(userId: string): Promise<string> {
    const row = await this.connections.find(userId, 'youtube');
    if (!row) {
      throw new BadRequestException('YouTube is not connected');
    }

    const skewMs = 60_000;
    if (row.expiresAt.getTime() - skewMs > Date.now()) {
      return this.connections.decryptAccessToken(row);
    }

    const refreshToken = this.connections.decryptRefreshToken(row);
    if (!refreshToken) {
      throw new BadRequestException(
        'YouTube access expired and no refresh token is stored — reconnect YouTube',
      );
    }

    const tokens = await this.refreshAccessToken(refreshToken);
    row.accessTokenEnc = encryptSecret(tokens.access_token);
    row.expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    if (tokens.refresh_token) {
      row.refreshTokenEnc = encryptSecret(tokens.refresh_token);
    }
    if (tokens.scope) row.scopes = tokens.scope;
    await this.connections.save(row);
    return tokens.access_token;
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: this.redirectUri(),
      grant_type: 'authorization_code',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await parseOAuthJson(res);
    if (!res.ok) {
      throw new BadRequestException(
        `token exchange failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    const access_token = jsonString(data, 'access_token');
    const expires_in = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    if (!access_token) throw new BadRequestException('token exchange failed: missing access_token');
    return {
      access_token,
      expires_in,
      refresh_token: jsonString(data, 'refresh_token'),
      scope: jsonString(data, 'scope'),
      token_type: jsonString(data, 'token_type') ?? 'Bearer',
    };
  }

  private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await parseOAuthJson(res);
    if (!res.ok) {
      throw new BadRequestException(
        `token refresh failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    const access_token = jsonString(data, 'access_token');
    const expires_in = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    if (!access_token) throw new BadRequestException('token refresh failed: missing access_token');
    return {
      access_token,
      expires_in,
      refresh_token: jsonString(data, 'refresh_token'),
      scope: jsonString(data, 'scope'),
      token_type: jsonString(data, 'token_type') ?? 'Bearer',
    };
  }

  private async fetchChannel(
    accessToken: string,
  ): Promise<{ id: string; title: string }> {
    const url =
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await parseOAuthJson(res)) as ChannelSnippet & Record<string, unknown>;
    if (!res.ok) {
      throw new BadRequestException(
        `channels.list failed: ${jsonString(data, 'error') ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    const item = data.items?.[0];
    if (!item?.id) {
      throw new BadRequestException('No YouTube channel found for this Google account');
    }
    return { id: item.id, title: item.snippet?.title ?? item.id };
  }
}
