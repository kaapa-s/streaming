import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface CompositorWarmupResult {
  room: string;
  resolution: string;
  state: 'warm';
}

export interface CompositorGoLiveResult {
  room: string;
  live: boolean;
  resolution: string;
}

export interface CompositorStopResult {
  room: string;
  file?: string;
  live: boolean;
}

@Injectable()
export class CompositorClient {
  private readonly logger = new Logger(CompositorClient.name);

  private baseUrl(): string {
    const url = process.env.COMPOSITOR_URL?.trim();
    if (!url) {
      throw new ServiceUnavailableException('COMPOSITOR_URL is not configured');
    }
    return url.replace(/\/$/, '');
  }

  private secret(): string {
    const secret = process.env.COMPOSITOR_INTERNAL_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('COMPOSITOR_INTERNAL_SECRET is not configured');
    }
    return secret;
  }

  async warmup(
    slug: string,
    body: { token: string; resolution?: string },
  ): Promise<CompositorWarmupResult> {
    return this.request('POST', `/internal/rooms/${encodeURIComponent(slug)}/warmup`, body);
  }

  async goLive(
    slug: string,
    body: { rtmpUrl?: string; resolution?: string; token?: string },
  ): Promise<CompositorGoLiveResult> {
    return this.request('POST', `/internal/rooms/${encodeURIComponent(slug)}/go-live`, body);
  }

  async stop(slug: string): Promise<CompositorStopResult> {
    return this.request('POST', `/internal/rooms/${encodeURIComponent(slug)}/stop`);
  }

  async upload(slug: string, putUrl: string): Promise<{ room: string; uploaded: boolean }> {
    return this.request('POST', `/internal/rooms/${encodeURIComponent(slug)}/upload`, { putUrl });
  }

  async setOverlay(
    slug: string,
    overlay: { author: string; text: string; until: number } | null,
  ): Promise<{ room: string; ok: boolean }> {
    return this.request('POST', `/internal/rooms/${encodeURIComponent(slug)}/overlay`, {
      overlay,
    });
  }

  async status(): Promise<unknown> {
    return this.request('GET', '/internal/status');
  }

  async health(): Promise<{ freeSlots: number; activeRooms: number }> {
    return this.request('GET', '/internal/health');
  }

  /** Best-effort warmup; logs and swallows errors so studio join is not blocked. */
  warmupInBackground(slug: string, token: string, resolution?: string): void {
    void this.warmup(slug, { token, resolution }).catch((err) => {
      this.logger.warn(`warmup failed for room ${slug}: ${String(err)}`);
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': this.secret(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }
    }
    if (!res.ok) {
      const msg =
        typeof parsed === 'object' &&
        parsed &&
        'message' in parsed &&
        (parsed as { message: unknown }).message
          ? String((parsed as { message: unknown }).message)
          : `compositor ${method} ${path} failed: ${res.status}`;
      throw new ServiceUnavailableException(msg);
    }
    return parsed as T;
  }
}
