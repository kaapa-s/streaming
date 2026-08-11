import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConnection } from '../entities/platform-connection.entity';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { decryptSecret, encryptSecret } from './token-crypto';

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
  private readonly logger = new Logger(YoutubeOAuthService.name);

  constructor(
    @InjectRepository(PlatformConnection)
    private readonly connections: Repository<PlatformConnection>,
  ) {}

  private clientId(): string {
    const id = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!id) throw new ServiceUnavailableException('GOOGLE_CLIENT_ID is not configured');
    return id;
  }

  private clientSecret(): string {
    const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('GOOGLE_CLIENT_SECRET is not configured');
    }
    return secret;
  }

  private redirectUri(): string {
    const uri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
    if (!uri) {
      throw new ServiceUnavailableException('GOOGLE_OAUTH_REDIRECT_URI is not configured');
    }
    return uri;
  }

  private webOrigin(): string {
    return (process.env.WEB_ORIGIN?.trim() || 'https://localhost:5173').replace(/\/$/, '');
  }

  buildConnectUrl(userId: string): { url: string } {
    const state = signOAuthState(userId);
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
    const studioUrl = `${this.webOrigin()}/live`;
    try {
      if (!code || !state) throw new BadRequestException('missing code or state');
      const userId = verifyOAuthState(state);
      const tokens = await this.exchangeCode(code);
      const channel = await this.fetchChannel(tokens.access_token);
      await this.upsertConnection(userId, tokens, channel);
      return `${studioUrl}?youtube=connected`;
    } catch (err) {
      this.logger.warn(`YouTube OAuth callback failed: ${String(err)}`);
      const msg = encodeURIComponent(
        err instanceof Error ? err.message : 'YouTube connect failed',
      );
      return `${studioUrl}?youtube=error&message=${msg}`;
    }
  }

  async status(userId: string): Promise<{
    connected: boolean;
    accountLabel?: string;
    externalAccountId?: string;
  }> {
    const row = await this.connections.findOne({
      where: { userId, provider: 'youtube' },
    });
    if (!row) return { connected: false };
    return {
      connected: true,
      accountLabel: row.accountLabel ?? undefined,
      externalAccountId: row.externalAccountId,
    };
  }

  async disconnect(userId: string): Promise<{ ok: true }> {
    await this.connections.delete({ userId, provider: 'youtube' });
    return { ok: true };
  }

  async getValidAccessToken(userId: string): Promise<string> {
    const row = await this.connections.findOne({
      where: { userId, provider: 'youtube' },
    });
    if (!row) {
      throw new BadRequestException('YouTube is not connected');
    }

    const skewMs = 60_000;
    if (row.expiresAt.getTime() - skewMs > Date.now()) {
      return decryptSecret(row.accessTokenEnc);
    }

    if (!row.refreshTokenEnc) {
      throw new BadRequestException(
        'YouTube access expired and no refresh token is stored — reconnect YouTube',
      );
    }

    const refreshToken = decryptSecret(row.refreshTokenEnc);
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
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(`token exchange failed: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as TokenResponse;
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
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(`token refresh failed: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as TokenResponse;
  }

  private async fetchChannel(
    accessToken: string,
  ): Promise<{ id: string; title: string }> {
    const url =
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(`channels.list failed: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as ChannelSnippet;
    const item = data.items?.[0];
    if (!item?.id) {
      throw new BadRequestException('No YouTube channel found for this Google account');
    }
    return { id: item.id, title: item.snippet?.title ?? item.id };
  }

  private async upsertConnection(
    userId: string,
    tokens: TokenResponse,
    channel: { id: string; title: string },
  ): Promise<void> {
    let row = await this.connections.findOne({
      where: { userId, provider: 'youtube' },
    });
    if (!row) {
      row = this.connections.create({
        userId,
        provider: 'youtube',
        externalAccountId: channel.id,
        accountLabel: channel.title,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: tokens.refresh_token
          ? encryptSecret(tokens.refresh_token)
          : null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope ?? YOUTUBE_SCOPES,
      });
    } else {
      row.externalAccountId = channel.id;
      row.accountLabel = channel.title;
      row.accessTokenEnc = encryptSecret(tokens.access_token);
      if (tokens.refresh_token) {
        row.refreshTokenEnc = encryptSecret(tokens.refresh_token);
      }
      row.expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      row.scopes = tokens.scope ?? row.scopes;
    }
    await this.connections.save(row);
  }
}
