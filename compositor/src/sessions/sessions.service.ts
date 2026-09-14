import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import * as path from 'path';
import type { Browser, Page } from 'puppeteer';
import type { ChildProcess } from 'child_process';
import { BrowserPoolService } from '../browser/browser-pool.service';
import { assertFfmpegAvailable, normalizeRtmpUrl, redactRtmp } from '../recordings/rtmp';
import {
  isLoopbackCompositorUrl,
  redactCompositorUrl,
  resolveRecorderPageOrigin,
} from '../recordings/page-origin';
import { SessionLog, sessionStamp, taggedRecordingPath } from '../recordings/session-log';
import {
  parseResolution,
  STREAM_PROFILES,
  type StreamResolution,
} from '@streaming/stream-quality';

type SessionState = 'warm' | 'recording';

interface LayoutPayload {
  cameraPreset: 'focus' | 'pip-left' | 'pip-right' | 'grid';
  featuredId: string | null;
  sceneScreenIds: string[];
}

interface RoomSession {
  state: SessionState;
  browser: Browser;
  page: Page;
  resolution: StreamResolution;
  rtmpUrl?: string;
  file?: string;
  ffmpeg?: ChildProcess;
  sessionLog?: SessionLog;
  stamp?: string;
  /** File path kept after stop until upload or release. */
  pendingFile?: string;
}

export interface RecordingSink {
  file: string;
  rtmpUrl?: string;
  resolution: StreamResolution;
  sessionLog?: SessionLog;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly dir = path.resolve(process.cwd(), 'recordings');
  private readonly sessions = new Map<string, RoomSession>();
  /** In-flight warmup per room — join + go-live must share one Chromium claim. */
  private readonly warming = new Map<
    string,
    Promise<{ room: string; resolution: StreamResolution; state: 'warm' }>
  >();

  constructor(private readonly pool: BrowserPoolService) {
    mkdirSync(this.dir, { recursive: true });
  }

  health() {
    return {
      freeSlots: this.pool.freeSlots(),
      activeRooms: this.sessions.size,
      rooms: [...this.sessions.entries()].map(([room, s]) => ({
        room,
        state: s.state,
        resolution: s.resolution,
        live: !!s.rtmpUrl,
        file: s.file ?? s.pendingFile,
      })),
    };
  }

  status(): { room: string; file?: string; live: boolean; resolution: StreamResolution; state: SessionState }[] {
    return [...this.sessions.entries()].map(([room, s]) => ({
      room,
      file: s.file ?? s.pendingFile,
      live: !!s.rtmpUrl,
      resolution: s.resolution,
      state: s.state,
    }));
  }

  /** Called by RecordingGateway when the compositor's chunk stream connects. */
  getSink(roomSlug: string): RecordingSink {
    const entry = this.sessions.get(roomSlug);
    if (!entry || entry.state !== 'recording') {
      throw new BadRequestException(`no recording session for room "${roomSlug}"`);
    }
    const stamp = entry.stamp ?? sessionStamp();
    entry.stamp = stamp;
    const file = path.join(this.dir, `${roomSlug}-${stamp}.webm`);
    entry.file = file;
    entry.sessionLog?.write(`recording file=${file}`);
    return {
      file,
      rtmpUrl: entry.rtmpUrl,
      resolution: entry.resolution,
      sessionLog: entry.sessionLog,
    };
  }

  attachFfmpeg(roomSlug: string, ffmpeg: ChildProcess): void {
    const entry = this.sessions.get(roomSlug);
    if (entry) entry.ffmpeg = ffmpeg;
  }

  async warmup(
    slug: string,
    token: string,
    resolutionInput?: string,
  ): Promise<{ room: string; resolution: StreamResolution; state: 'warm' }> {
    const room = slug.trim().toLowerCase();
    const existing = this.sessions.get(room);
    if (existing) {
      if (existing.state === 'recording') {
        throw new BadRequestException(`room "${room}" is already recording`);
      }
      return { room, resolution: existing.resolution, state: 'warm' };
    }
    const inFlight = this.warming.get(room);
    if (inFlight) return inFlight;

    const task = this.warmupOnce(room, token, resolutionInput).finally(() => {
      this.warming.delete(room);
    });
    this.warming.set(room, task);
    return task;
  }

  private async warmupOnce(
    room: string,
    token: string,
    resolutionInput?: string,
  ): Promise<{ room: string; resolution: StreamResolution; state: 'warm' }> {
    const already = this.sessions.get(room);
    if (already) {
      if (already.state === 'recording') {
        throw new BadRequestException(`room "${room}" is already recording`);
      }
      return { room, resolution: already.resolution, state: 'warm' };
    }

    const resolution = parseResolution(resolutionInput);
    const profile = STREAM_PROFILES[resolution];
    const browser = await this.pool.claim();
    let page: Page | undefined;
    try {
      page = await browser.newPage();
      await page.setViewport({
        width: profile.width,
        height: profile.height,
        deviceScaleFactor: 1,
      });
      page.on('console', (msg) => {
        console.log(`[compositor:${room}] ${msg.text()}`);
      });
      page.on('pageerror', (err) => {
        console.error(`[compositor:${room}] page error:`, String(err));
      });

      const url = this.buildCompositorUrl(room, resolution, token, 'idle');
      this.logger.log(`warmup navigating room=${room} ${redactCompositorUrl(url)}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const landed = page.url();
      if (!isLoopbackCompositorUrl(landed)) {
        throw new Error(
          `recorder page loaded ${redactCompositorUrl(landed)} instead of loopback /compositor/ ` +
            `(Chromium must use http://127.0.0.1:${process.env.PORT ?? 3002}/compositor/)`,
        );
      }
      await page.waitForFunction(
        () => typeof globalThis.__startRecording === 'function',
        { timeout: 60_000 },
      );

      this.sessions.set(room, {
        state: 'warm',
        browser,
        page,
        resolution,
      });
      this.logger.log(`warmed room=${room} resolution=${resolution}`);
      return { room, resolution, state: 'warm' };
    } catch (err) {
      if (page) await page.close().catch(() => undefined);
      this.pool.release(browser);
      throw err;
    }
  }

  async goLive(
    slug: string,
    opts: { rtmpUrl?: string; resolution?: string; token?: string },
  ): Promise<{ room: string; live: boolean; resolution: StreamResolution }> {
    const room = slug.trim().toLowerCase();
    let entry = this.sessions.get(room);

    const resolution = parseResolution(opts.resolution ?? entry?.resolution);
    const normalized = opts.rtmpUrl?.trim()
      ? normalizeRtmpUrl(opts.rtmpUrl.trim())
      : undefined;
    if (normalized) assertFfmpegAvailable();

    if (!entry) {
      if (!opts.token) {
        throw new BadRequestException(
          `room "${room}" is not warmed — provide a join token to warmup on go-live`,
        );
      }
      await this.warmup(room, opts.token, resolution);
      entry = this.sessions.get(room);
    }
    if (!entry) throw new BadRequestException(`failed to warmup room "${room}"`);
    if (entry.state === 'recording') {
      throw new BadRequestException(`already recording room "${room}"`);
    }

    // Resolution change while warm: re-navigate.
    if (entry.resolution !== resolution) {
      if (!opts.token) {
        throw new BadRequestException('resolution change requires a fresh join token');
      }
      await this.releaseRoom(room, { keepPending: false });
      await this.warmup(room, opts.token, resolution);
      entry = this.sessions.get(room);
      if (!entry) throw new BadRequestException(`failed to re-warmup room "${room}"`);
    }

    const stamp = sessionStamp();
    const sessionLog = new SessionLog(this.dir, room, stamp);
    sessionLog.write(
      `go-live room=${room} resolution=${resolution} ` +
        `live=${!!normalized} rtmp=${normalized ? redactRtmp(normalized) : 'none'} ` +
        `profile=${STREAM_PROFILES[resolution].width}x${STREAM_PROFILES[resolution].height}`,
    );

    entry.state = 'recording';
    entry.rtmpUrl = normalized;
    entry.stamp = stamp;
    entry.sessionLog = sessionLog;
    entry.pendingFile = undefined;
    entry.file = undefined;

    try {
      await entry.page.evaluate(async (requireH264: boolean) => {
        const start = globalThis.__startRecording;
        if (!start) throw new Error('__startRecording not available');
        await start({ requireH264 });
      }, !!normalized);
      await this.writeSceneSnapshot(entry);
    } catch (err) {
      entry.state = 'warm';
      entry.rtmpUrl = undefined;
      sessionLog.write(`go-live failed: ${String(err)}`);
      sessionLog.close('status=failed');
      entry.sessionLog = undefined;
      throw err;
    }

    this.logger.log(
      `recording started room=${room} ${resolution}` +
        `${normalized ? ` → ${redactRtmp(normalized)}` : ''} (log ${sessionLog.path})`,
    );
    return { room, live: !!normalized, resolution };
  }

  async stop(slug: string): Promise<{ room: string; file?: string; live: boolean }> {
    const room = slug.trim().toLowerCase();
    const entry = this.sessions.get(room);
    if (!entry) throw new NotFoundException(`no active session for room "${room}"`);
    if (entry.state !== 'recording') {
      // Warm-only: just release.
      await this.releaseRoom(room, { keepPending: false });
      return { room, live: false };
    }

    const wasLive = !!entry.rtmpUrl;
    entry.sessionLog?.write('stop requested');

    try {
      await entry.page.evaluate(() => {
        globalThis.__clearOverlay?.();
      });
    } catch {
      /* overlay clear is best-effort */
    }

    try {
      await entry.page.evaluate(async () => {
        await globalThis.__stopRecording?.();
      });
    } catch (err) {
      this.logger.error(`graceful stop failed for room ${room}: ${String(err)}`);
      entry.sessionLog?.write(`graceful stop failed: ${String(err)}`);
    }

    if (entry.ffmpeg && !entry.ffmpeg.killed) {
      try {
        entry.ffmpeg.stdin?.end();
      } catch {
        /* ignore */
      }
      await Promise.race([
        new Promise<void>((resolve) => entry.ffmpeg?.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (!entry.ffmpeg.killed) entry.ffmpeg.kill('SIGTERM');
    }

    const file = entry.file;
    entry.sessionLog?.close(`status=stopped file=${file ?? 'none'} live=${wasLive}`);
    entry.pendingFile = file;
    entry.sessionLog = undefined;
    entry.ffmpeg = undefined;
    entry.rtmpUrl = undefined;
    entry.file = undefined;
    entry.stamp = undefined;

    // Recycle tab but keep Chromium; drop room session after short grace for upload.
    await this.releaseRoom(room, { keepPending: true, pendingFile: file });

    this.logger.log(`stopped room=${room} file=${file ?? 'none'}`);
    return { room, file, live: wasLive };
  }

  async setOverlay(
    slug: string,
    overlay: { author: string; text: string; until: number } | null,
  ): Promise<{ room: string; ok: boolean }> {
    const room = slug.trim().toLowerCase();
    const entry = this.sessions.get(room);
    if (!entry) throw new NotFoundException(`no active session for room "${room}"`);
    await entry.page.evaluate((payload) => {
      if (payload === null) {
        globalThis.__clearOverlay?.();
        return;
      }
      const set = globalThis.__setOverlay;
      if (!set) throw new Error('__setOverlay not available');
      set(payload);
    }, overlay);
    return { room, ok: true };
  }

  async setLayout(slug: string, state: LayoutPayload): Promise<{ room: string; ok: boolean }> {
    const room = slug.trim().toLowerCase();
    const entry = this.sessions.get(room);
    if (!entry) throw new NotFoundException(`no active session for room "${room}"`);
    await entry.page.evaluate((payload) => {
      const set = globalThis.__setLayout;
      if (!set) throw new Error('__setLayout not available');
      set(payload);
    }, state);
    if (entry.state === 'recording') {
      await this.writeSceneSnapshot(entry);
    }
    return { room, ok: true };
  }

  private async writeSceneSnapshot(entry: RoomSession): Promise<void> {
    if (!entry.sessionLog) return;
    try {
      const snapshot = await entry.page.evaluate(() => globalThis.__getLayoutSnapshot?.());
      if (!snapshot) return;
      entry.sessionLog.write(`scene ${JSON.stringify(snapshot)}`);
    } catch (err) {
      this.logger.warn(`scene snapshot failed: ${String(err)}`);
    }
  }

  async upload(slug: string, putUrl: string): Promise<{ room: string; uploaded: boolean }> {
    const room = slug.trim().toLowerCase();
    const pending = this.sessions.get(room)?.pendingFile
      ?? this.takePendingFile(room);
    if (!pending) {
      throw new NotFoundException(`no pending recording file for room "${room}"`);
    }

    const body = readFileSync(pending);
    const res = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/webm',
        'Content-Length': String(body.byteLength),
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(
        `S3 upload failed status=${res.status} ${text.slice(0, 200)}`,
      );
    }
    try {
      const tagged = taggedRecordingPath(pending);
      if (tagged !== pending) renameSync(pending, tagged);
      unlinkSync(tagged);
      this.logger.log(`uploaded room=${room} file=${pending} removed=${tagged}`);
    } catch (err) {
      this.logger.warn(
        `uploaded room=${room} file=${pending} but local cleanup failed: ${String(err)}`,
      );
    }
    this.clearPendingFile(room);
    return { room, uploaded: true };
  }

  /** Delete leftover `*.webm` on disk. Skips in-progress / pending-upload files. */
  purgeLocalRecordings(): { deleted: string[]; skipped: string[] } {
    const skip = new Set<string>();
    for (const s of this.sessions.values()) {
      if (s.file) skip.add(path.resolve(s.file));
      if (s.pendingFile) skip.add(path.resolve(s.pendingFile));
    }
    for (const file of this.pendingFiles.values()) {
      skip.add(path.resolve(file));
    }

    const deleted: string[] = [];
    const skipped: string[] = [];
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch (err) {
      this.logger.warn(`purge: cannot read ${this.dir}: ${String(err)}`);
      return { deleted, skipped };
    }

    for (const name of names) {
      if (!name.endsWith('.webm')) continue;
      const full = path.resolve(this.dir, name);
      try {
        if (!statSync(full).isFile()) continue;
      } catch {
        continue;
      }
      if (skip.has(full)) {
        skipped.push(full);
        continue;
      }
      try {
        unlinkSync(full);
        deleted.push(full);
      } catch (err) {
        this.logger.warn(`purge: failed to remove ${full}: ${String(err)}`);
      }
    }
    this.logger.log(`purged local recordings deleted=${deleted.length} skipped=${skipped.length}`);
    return { deleted, skipped };
  }

  private pendingFiles = new Map<string, string>();

  private takePendingFile(room: string): string | undefined {
    const file = this.pendingFiles.get(room);
    return file;
  }

  private clearPendingFile(room: string): void {
    this.pendingFiles.delete(room);
    const entry = this.sessions.get(room);
    if (entry) entry.pendingFile = undefined;
  }

  private async releaseRoom(
    room: string,
    opts: { keepPending: boolean; pendingFile?: string },
  ): Promise<void> {
    const entry = this.sessions.get(room);
    if (!entry) return;
    this.sessions.delete(room);
    if (opts.keepPending && opts.pendingFile) {
      this.pendingFiles.set(room, opts.pendingFile);
    }
    await entry.page.close().catch(() => undefined);
    this.pool.release(entry.browser);
  }

  private buildCompositorUrl(
    room: string,
    resolution: StreamResolution,
    token: string,
    mode: 'idle' | 'record',
  ): string {
    const port = process.env.PORT ?? 3002;
    const { origin: pageOrigin, ignored } = resolveRecorderPageOrigin();
    if (ignored) {
      this.logger.warn(
        `COMPOSITOR_PAGE_ORIGIN=${ignored} is not loopback; using ${pageOrigin} so Chromium loads the recorder page in this container`,
      );
    }
    const sinkUrl =
      process.env.RECORDING_SINK_URL?.trim() ||
      `ws://127.0.0.1:${port}/ws/recording`;
    const sfuUrl = process.env.SFU_PUBLIC_WS_URL?.trim();
    return (
      `${pageOrigin}/compositor/?room=${encodeURIComponent(room)}` +
      `&resolution=${encodeURIComponent(resolution)}` +
      `&token=${encodeURIComponent(token)}` +
      `&mode=${encodeURIComponent(mode)}` +
      `&sinkUrl=${encodeURIComponent(sinkUrl)}` +
      (sfuUrl ? `&sfuUrl=${encodeURIComponent(sfuUrl)}` : '')
    );
  }
}

