import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { spawnSync, type ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';
import * as path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import {
  parseResolution,
  STREAM_PROFILES,
  type StreamResolution,
} from './stream-quality';

interface ActiveRecording {
  browser: Browser;
  page: Page;
  file?: string;
  rtmpUrl?: string;
  resolution: StreamResolution;
  ffmpeg?: ChildProcess;
}

export interface RecordingSink {
  file: string;
  rtmpUrl?: string;
  resolution: StreamResolution;
}

@Injectable()
export class RecordingsService {
  private readonly dir = path.resolve(process.cwd(), 'recordings');
  private active = new Map<string, ActiveRecording>();

  /** Called by RecordingGateway when the compositor's chunk stream connects. */
  getSink(room: string): RecordingSink {
    mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${room}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`);
    const entry = this.active.get(room);
    if (entry) entry.file = file;
    return { file, rtmpUrl: entry?.rtmpUrl, resolution: entry?.resolution ?? '720p' };
  }

  attachFfmpeg(room: string, ffmpeg: ChildProcess): void {
    const entry = this.active.get(room);
    if (entry) entry.ffmpeg = ffmpeg;
  }

  async start(
    room: string,
    rtmpUrl?: string,
    resolutionInput?: string,
  ): Promise<{ room: string; live: boolean; resolution: StreamResolution }> {
    if (this.active.has(room)) throw new BadRequestException(`already recording room "${room}"`);

    const resolution = parseResolution(resolutionInput);
    const profile = STREAM_PROFILES[resolution];
    const normalized = rtmpUrl?.trim() ? normalizeRtmpUrl(rtmpUrl.trim()) : undefined;
    if (normalized) assertFfmpegAvailable();

    const webOrigin = process.env.WEB_ORIGIN ?? 'https://localhost:5173';
    const browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        // Dev Vite uses a local mkcert CA; Chromium won't trust it by default.
        '--ignore-certificate-errors',
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: 1 });
      page.on('console', (msg) => console.log(`[compositor:${room}] ${msg.text()}`));
      page.on('pageerror', (err) => console.error(`[compositor:${room}] page error:`, String(err)));
      this.active.set(room, { browser, page, rtmpUrl: normalized, resolution });
      const compositorUrl =
        `${webOrigin}/compositor?room=${encodeURIComponent(room)}` +
        `&resolution=${encodeURIComponent(resolution)}`;
      await page.goto(compositorUrl, { waitUntil: 'domcontentloaded' });
      console.log(
        `[recordings] started ${resolution} recorder for room ${room}` +
          `${normalized ? ` → ${redactRtmp(normalized)}` : ''}`,
      );
      return { room, live: !!normalized, resolution };
    } catch (err) {
      this.active.delete(room);
      await browser.close().catch(() => undefined);
      throw err;
    }
  }

  async stop(room: string): Promise<{ room: string; file?: string; live: boolean }> {
    const entry = this.active.get(room);
    if (!entry) throw new NotFoundException(`no active recording for room "${room}"`);
    this.active.delete(room);
    const wasLive = !!entry.rtmpUrl;

    try {
      // Compositor page exposes __stopRecording; it stops MediaRecorder and
      // flushes remaining chunks over the WebSocket before resolving.
      await entry.page.evaluate(() => (globalThis as any).__stopRecording?.());
    } catch (err) {
      console.error(`[recordings] graceful stop failed for room ${room}:`, err);
    }

    if (entry.ffmpeg && !entry.ffmpeg.killed) {
      try {
        entry.ffmpeg.stdin?.end();
      } catch {
        /* ignore */
      }
      // Don't wait forever if YouTube/ffmpeg hang on teardown.
      await Promise.race([
        new Promise<void>((resolve) => entry.ffmpeg?.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (!entry.ffmpeg.killed) entry.ffmpeg.kill('SIGTERM');
    }

    await entry.browser.close().catch(() => undefined);
    console.log(`[recordings] stopped recorder for room ${room} -> ${entry.file ?? 'no file'}`);
    return { room, file: entry.file, live: wasLive };
  }

  status(): { room: string; file?: string; live: boolean; resolution: StreamResolution }[] {
    return [...this.active.entries()].map(([room, { file, rtmpUrl, resolution }]) => ({
      room,
      file,
      live: !!rtmpUrl,
      resolution,
    }));
  }
}

function assertFfmpegAvailable(): void {
  const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const result = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new BadRequestException(
      `ffmpeg not found (${bin}). Install it (e.g. brew install ffmpeg) to go live on YouTube.`,
    );
  }
}

/** Accept a full RTMP URL, or a bare YouTube stream key. */
export function normalizeRtmpUrl(input: string): string {
  if (/^rtmps?:\/\//i.test(input)) {
    // Require a path segment after the app name so a bare base URL isn't used.
    try {
      const u = new URL(input);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 2) {
        throw new BadRequestException(
          'RTMP URL must include the stream key, e.g. rtmp://a.rtmp.youtube.com/live2/<key>',
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Invalid RTMP URL');
    }
    return input;
  }

  // Bare stream key (YouTube keys look like xxxx-xxxx-xxxx-xxxx).
  if (/^[A-Za-z0-9_-]+$/.test(input) && input.length >= 8) {
    return `rtmp://a.rtmp.youtube.com/live2/${input}`;
  }

  throw new BadRequestException(
    'Provide a full RTMP URL (rtmp://a.rtmp.youtube.com/live2/<key>) or just the YouTube stream key',
  );
}

function redactRtmp(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    if (parts.length > 0) parts[parts.length - 1] = '***';
    u.pathname = parts.join('/');
    return u.toString();
  } catch {
    return 'rtmp://***';
  }
}
