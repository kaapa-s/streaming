import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawnSync, type ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';
import * as path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import { Repository } from 'typeorm';
import { Recording, Room } from '../entities';
import { RoomsService } from '../rooms/rooms.service';
import { SessionLog, sessionStamp } from './session-log';
import {
  parseResolution,
  STREAM_PROFILES,
  type StreamResolution,
} from './stream-quality';

interface ActiveRecording {
  browser: Browser;
  page: Page;
  roomId: string;
  recordingId: string;
  file?: string;
  rtmpUrl?: string;
  resolution: StreamResolution;
  ffmpeg?: ChildProcess;
  sessionLog: SessionLog;
  stamp: string;
}

export interface RecordingSink {
  file: string;
  rtmpUrl?: string;
  resolution: StreamResolution;
  sessionLog?: SessionLog;
}

@Injectable()
export class RecordingsService {
  private readonly dir = path.resolve(process.cwd(), 'recordings');
  private active = new Map<string, ActiveRecording>();

  constructor(
    private readonly rooms: RoomsService,
    @InjectRepository(Recording)
    private readonly recordings: Repository<Recording>,
  ) {}

  /** Called by RecordingGateway when the compositor's chunk stream connects. */
  getSink(roomSlug: string): RecordingSink {
    mkdirSync(this.dir, { recursive: true });
    const entry = this.active.get(roomSlug);
    const stamp = entry?.stamp ?? sessionStamp();
    const file = path.join(this.dir, `${roomSlug}-${stamp}.webm`);
    if (entry) {
      entry.file = file;
      entry.sessionLog.write(`recording file=${file}`);
      void this.recordings.update(entry.recordingId, { filePath: file, status: 'recording' });
    }
    return {
      file,
      rtmpUrl: entry?.rtmpUrl,
      resolution: entry?.resolution ?? '720p',
      sessionLog: entry?.sessionLog,
    };
  }

  attachFfmpeg(roomSlug: string, ffmpeg: ChildProcess): void {
    const entry = this.active.get(roomSlug);
    if (entry) entry.ffmpeg = ffmpeg;
  }

  async start(
    room: Room,
    rtmpUrl?: string,
    resolutionInput?: string,
  ): Promise<{ room: string; live: boolean; resolution: StreamResolution }> {
    const slug = room.slug;
    if (this.active.has(slug)) throw new BadRequestException(`already recording room "${slug}"`);

    const resolution = parseResolution(resolutionInput);
    const profile = STREAM_PROFILES[resolution];
    const normalized = rtmpUrl?.trim() ? normalizeRtmpUrl(rtmpUrl.trim()) : undefined;
    if (normalized) assertFfmpegAvailable();

    const row = await this.recordings.save(
      this.recordings.create({
        roomId: room.id,
        status: 'starting',
        resolution,
        startedAt: new Date(),
        filePath: null,
        endedAt: null,
      }),
    );

    const joinToken = this.rooms.issueCompositorJoinToken(slug);
    const webOrigin = process.env.WEB_ORIGIN ?? 'https://localhost:5173';
    const stamp = sessionStamp();
    const sessionLog = new SessionLog(this.dir, slug, stamp);
    sessionLog.write(
      `start room=${slug} resolution=${resolution} ` +
        `live=${!!normalized} rtmp=${normalized ? redactRtmp(normalized) : 'none'} ` +
        `profile=${profile.width}x${profile.height}@${profile.fps}`,
    );

    let browser: Browser;
    try {
      browser = await puppeteer.launch({
        args: [
          '--no-sandbox',
          '--autoplay-policy=no-user-gesture-required',
          '--use-fake-ui-for-media-stream',
          ...(process.env.NODE_ENV !== 'production'
            ? ['--ignore-certificate-errors']
            : []),
        ],
      });
    } catch (err) {
      sessionLog.write(`puppeteer launch failed: ${String(err)}`);
      sessionLog.close('status=failed');
      await this.recordings.update(row.id, { status: 'failed', endedAt: new Date() });
      throw err;
    }
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: 1 });
      page.on('console', (msg) => {
        const text = msg.text();
        console.log(`[compositor:${slug}] ${text}`);
        sessionLog.write(`compositor console: ${text}`);
      });
      page.on('pageerror', (err) => {
        console.error(`[compositor:${slug}] page error:`, String(err));
        sessionLog.write(`compositor pageerror: ${String(err)}`);
      });
      this.active.set(slug, {
        browser,
        page,
        roomId: room.id,
        recordingId: row.id,
        rtmpUrl: normalized,
        resolution,
        sessionLog,
        stamp,
      });
      const sfuUrl = process.env.SFU_PUBLIC_WS_URL?.trim();
      const compositorUrl =
        `${webOrigin}/compositor?room=${encodeURIComponent(slug)}` +
        `&resolution=${encodeURIComponent(resolution)}` +
        `&token=${encodeURIComponent(joinToken)}` +
        (sfuUrl ? `&sfuUrl=${encodeURIComponent(sfuUrl)}` : '');
      await page.goto(compositorUrl, { waitUntil: 'domcontentloaded' });
      sessionLog.write(`compositor navigated url=${webOrigin}/compositor?room=${slug}&resolution=${resolution}`);
      console.log(
        `[recordings] started ${resolution} recorder for room ${slug}` +
          `${normalized ? ` → ${redactRtmp(normalized)}` : ''} (log ${sessionLog.path})`,
      );
      return { room: slug, live: !!normalized, resolution };
    } catch (err) {
      this.active.delete(slug);
      sessionLog.write(`start failed: ${String(err)}`);
      sessionLog.close('status=failed');
      await this.recordings.update(row.id, { status: 'failed', endedAt: new Date() });
      await browser.close().catch(() => undefined);
      throw err;
    }
  }

  async stop(room: Room): Promise<{ room: string; file?: string; live: boolean }> {
    const slug = room.slug;
    const entry = this.active.get(slug);
    if (!entry) throw new NotFoundException(`no active recording for room "${slug}"`);
    this.active.delete(slug);
    const wasLive = !!entry.rtmpUrl;
    entry.sessionLog.write('stop requested');

    try {
      // Compositor page exposes __stopRecording; it stops MediaRecorder and
      // flushes remaining chunks over the WebSocket before resolving.
      await entry.page.evaluate(() => globalThis.__stopRecording?.());
    } catch (err) {
      console.error(`[recordings] graceful stop failed for room ${slug}:`, err);
      entry.sessionLog.write(`graceful stop failed: ${String(err)}`);
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
    await this.recordings.update(entry.recordingId, {
      status: 'stopped',
      filePath: entry.file ?? null,
      endedAt: new Date(),
    });
    entry.sessionLog.close(
      `status=stopped file=${entry.file ?? 'none'} live=${wasLive}`,
    );
    console.log(
      `[recordings] stopped recorder for room ${slug} -> ${entry.file ?? 'no file'} ` +
        `(log ${entry.sessionLog.path})`,
    );
    return { room: slug, file: entry.file, live: wasLive };
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
