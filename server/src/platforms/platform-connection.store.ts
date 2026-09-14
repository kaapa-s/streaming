import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConnection } from '../entities/platform-connection.entity';
import { decryptSecret, encryptSecret } from './token-crypto';
import {
  PLATFORM_LABELS,
  PLATFORM_PROVIDERS,
  type PlatformProvider,
} from './platform-ids';

export type PlatformStatus = {
  connected: boolean;
  accountLabel?: string;
  externalAccountId?: string;
};

export type AllPlatformStatus = Record<PlatformProvider, PlatformStatus>;

@Injectable()
export class PlatformConnectionStore {
  constructor(
    @InjectRepository(PlatformConnection)
    private readonly connections: Repository<PlatformConnection>,
  ) {}

  async status(userId: string, provider: PlatformProvider): Promise<PlatformStatus> {
    const row = await this.connections.findOne({ where: { userId, provider } });
    if (!row) return { connected: false };
    return {
      connected: true,
      accountLabel: row.accountLabel ?? undefined,
      externalAccountId: row.externalAccountId,
    };
  }

  async statusAll(userId: string): Promise<AllPlatformStatus> {
    const rows = await this.connections.find({ where: { userId } });
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    const out = {} as AllPlatformStatus;
    for (const provider of PLATFORM_PROVIDERS) {
      const row = byProvider.get(provider);
      out[provider] = row
        ? {
            connected: true,
            accountLabel: row.accountLabel ?? undefined,
            externalAccountId: row.externalAccountId,
          }
        : { connected: false };
    }
    return out;
  }

  async assertConnected(userId: string, provider: PlatformProvider): Promise<void> {
    const row = await this.connections.findOne({ where: { userId, provider } });
    if (!row) {
      throw new BadRequestException(`${PLATFORM_LABELS[provider]} is not connected`);
    }
  }

  async disconnect(userId: string, provider: PlatformProvider): Promise<{ ok: true }> {
    await this.connections.delete({ userId, provider });
    return { ok: true };
  }

  async find(userId: string, provider: PlatformProvider): Promise<PlatformConnection | null> {
    return this.connections.findOne({ where: { userId, provider } });
  }

  async save(row: PlatformConnection): Promise<PlatformConnection> {
    return this.connections.save(row);
  }

  async upsert(params: {
    userId: string;
    provider: PlatformProvider;
    externalAccountId: string;
    accountLabel: string | null;
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scopes: string;
  }): Promise<void> {
    let row = await this.connections.findOne({
      where: { userId: params.userId, provider: params.provider },
    });
    if (!row) {
      row = this.connections.create({
        userId: params.userId,
        provider: params.provider,
        externalAccountId: params.externalAccountId,
        accountLabel: params.accountLabel,
        accessTokenEnc: encryptSecret(params.accessToken),
        refreshTokenEnc: params.refreshToken ? encryptSecret(params.refreshToken) : null,
        expiresAt: new Date(Date.now() + params.expiresIn * 1000),
        scopes: params.scopes,
      });
    } else {
      row.externalAccountId = params.externalAccountId;
      row.accountLabel = params.accountLabel;
      row.accessTokenEnc = encryptSecret(params.accessToken);
      if (params.refreshToken) {
        row.refreshTokenEnc = encryptSecret(params.refreshToken);
      }
      row.expiresAt = new Date(Date.now() + params.expiresIn * 1000);
      row.scopes = params.scopes;
    }
    await this.connections.save(row);
  }

  decryptAccessToken(row: PlatformConnection): string {
    return decryptSecret(row.accessTokenEnc);
  }

  decryptRefreshToken(row: PlatformConnection): string | null {
    return row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null;
  }
}
