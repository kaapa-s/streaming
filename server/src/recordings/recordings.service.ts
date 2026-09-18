import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { stat } from 'fs/promises';
import { resolve } from 'path';
import type { Response } from 'express';
import { CommentsService } from '../comments/comments.service';
import { ACTIVE_RECORDING_STATUSES, Recording, Room, type RecordingStatus } from '../entities';
import type { PlatformProvider } from '../platforms/platform-ids';
import { PlatformConnectionStore } from '../platforms/platform-connection.store';
import { normalizeOutboundRtmp } from '../platforms/outbound-rtmp';
import { RoomsService } from '../rooms/rooms.service';
import { CompositorClient } from './compositor.client';
import { resolveDestinations } from './destinations';
import { issueMediaToken, verifyMediaToken, type MediaTokenPayload } from './media-token';
import type { StartRecordingDto } from './recordings.dto';
import { S3PresignService } from './s3-presign.service';
import { postSfuInternal } from './sfu-internal';
import { parseResolution, type StreamResolution } from '@streaming/stream-quality';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mediaDurationSeconds(startedAt: Date | null, endedAt: Date | null): number | null {
  if (!startedAt || !endedAt) return null;
  const seconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
  return seconds >= 0 ? seconds : null;
}

export interface SessionState {
  room: string;
  roomStatus: Room['status'];
  active: boolean;
  live: boolean;
  status: RecordingStatus | null;
  startedAt: Date | null;
  destinations: PlatformProvider[];
  error: string | null;
}

/** Member-visible subset of the session: who is sharing, without owner-only controls. */
export interface RoomShareState {
  active: boolean;
  live: boolean;
  status: RecordingStatus | null;
  startedAt: Date | null;
  destinations: PlatformProvider[];
  error: string | null;
}

/**
 * Owner-facing recorded output of a room. `playbackUrl`/`downloadUrl` are either
 * cloud-signed or API-signed for self-hosted media, so the browser can render
 * and save the recording without a Bearer header.
 */
export interface RoomMedia {
  status: RecordingStatus;
  live: boolean;
  resolution: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  error: string | null;
  file: string | null;
  playbackUrl?: string;
  downloadUrl?: string;
}

@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly rooms: RoomsService,
    private readonly compositor: CompositorClient,
    private readonly s3: S3PresignService,
    @InjectRepository(Recording)
    private readonly recordings: Repository<Recording>,
    @Inject(forwardRef(() => CommentsService))
    private readonly comments: CommentsService,
    private readonly platforms: PlatformConnectionStore,
  ) {}

  /**
   * Sessions are durable, so an API restart must not strand a room as active.
   * Compare persisted active rows against the compositor: a row with no live
   * compositor session was lost and is finalized as failed.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.reconcileSessions();
    } catch (err) {
      this.logger.warn(`session reconciliation skipped: ${String(err)}`);
    }
  }

  private async reconcileSessions(): Promise<void> {
    const rows = await this.recordings.find({ where: { status: In(ACTIVE_RECORDING_STATUSES) } });
    if (rows.length === 0) return;

    let compositorStatus: unknown;
    try {
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('compositor status timed out')), 3000);
        timer.unref?.();
      });
      compositorStatus = await Promise.race([this.compositor.status(), timeout]);
    } catch {
      // Compositor may still be starting; leave the sessions untouched for now.
      return;
    }
    const byRoom = new Map<string, { state?: string }>();
    if (Array.isArray(compositorStatus)) {
      for (const entry of compositorStatus as Array<{ room?: string; state?: string }>) {
        if (entry?.room) byRoom.set(String(entry.room).toLowerCase(), entry);
      }
    }

    const roomRepo = this.dataSource.getRepository(Room);
    for (const row of rows) {
      const room = await roomRepo.findOne({ where: { id: row.roomId } });
      const session = room ? byRoom.get(room.slug.toLowerCase()) : undefined;
      if (session?.state === 'recording') continue;

      await this.dataSource.transaction(async (manager) => {
        await manager.update(Recording, row.id, {
          status: 'failed',
          error: row.error ?? 'Media session was lost before it was stopped',
          endedAt: row.endedAt ?? new Date(),
        });
        if (room) {
          await manager.update(Room, { id: room.id, status: 'active' }, { status: 'finished' });
        }
      });
      this.logger.warn(
        `reconciled lost session room=${room?.slug ?? row.roomId} recording=${row.id} status=${row.status}`,
      );
      if (room) {
        // Release both auxiliary services: a lost session must not leave a warm
        // compositor tab or an SFU router behind for a finished room.
        void this.compositor.discard(room.slug).catch(() => undefined);
        void this.cleanupSfuRoom(room.slug);
      }
    }
  }

  /** Best-effort teardown of SFU router/participant state for a finished room. */
  private async cleanupSfuRoom(slug: string): Promise<void> {
    try {
      await postSfuInternal(`/internal/rooms/${encodeURIComponent(slug)}/discard`);
    } catch (err) {
      this.logger.warn(`SFU cleanup failed for finished room ${slug}: ${errorMessage(err)}`);
    }
  }

  /**
   * The room's current media session. Durable room state, not the owner browser
   * connection, decides whether a session is active.
   */
  private activeRecording(roomId: string, manager?: EntityManager): Promise<Recording | null> {
    const repo = manager ? manager.getRepository(Recording) : this.recordings;
    return repo.findOne({
      where: { roomId, status: In(ACTIVE_RECORDING_STATUSES) },
      order: { createdAt: 'DESC' },
    });
  }

  async start(
    room: Room,
    userId: string,
    body: StartRecordingDto,
  ): Promise<{
    room: string;
    live: boolean;
    resolution: StreamResolution;
    destinations: PlatformProvider[];
  }> {
    const slug = room.slug;

    const localRtmpUrl = body.localRtmpUrl?.trim();
    if (localRtmpUrl && !/^rtmp:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(localRtmpUrl)) {
      throw new BadRequestException('localRtmpUrl must use a loopback RTMP URL');
    }
    const destinations = localRtmpUrl ? [] : resolveDestinations(body);
    for (const dest of destinations) {
      await this.platforms.assertConnected(userId, dest.platform);
    }
    const rtmpUrls = localRtmpUrl ? [localRtmpUrl] : destinations.map((dest) =>
      normalizeOutboundRtmp(dest.streamKey, dest.platform),
    );
    const destinationIds = destinations.map((dest) => dest.platform);
    const live = rtmpUrls.length > 0;

    const resolution = parseResolution(body.resolution);
    const token = this.rooms.issueCompositorJoinToken(slug);

    let row: Recording;
    try {
      row = await this.dataSource.transaction(async (manager) => {
        const lockedRoom = await manager.findOne(Room, {
          where: { id: room.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedRoom) throw new NotFoundException(`room "${slug}" not found`);
        if (lockedRoom.ownerId !== userId) {
          throw new ForbiddenException('only the room owner can start a session');
        }
        if (lockedRoom.status !== 'created') {
          throw new ConflictException(
            `room "${slug}" cannot be activated from status "${lockedRoom.status}"`,
          );
        }
        const existing = await this.activeRecording(lockedRoom.id, manager);
        if (existing) {
          throw new ConflictException(`room "${slug}" already has an active session`);
        }

        const recording = manager.create(Recording, {
          roomId: lockedRoom.id,
          status: 'starting',
          live,
          destinations: destinationIds,
          resolution,
          startedAt: new Date(),
          filePath: null,
          s3Key: null,
          endedAt: null,
          error: null,
        });
        await manager.save(Recording, recording);
        lockedRoom.status = 'active';
        await manager.save(Room, lockedRoom);
        return recording;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.rooms.activeOwnedBy(userId);
        throw new ConflictException(
          existing
            ? `user already owns a current room: ${existing.slug}`
            : 'user already owns a current room',
        );
      }
      throw err;
    }

    try {
      const result = await this.compositor.goLive(slug, {
        rtmpUrls: live ? rtmpUrls : undefined,
        resolution,
        token,
      });
      await this.recordings.update(row.id, { status: 'recording' });
      await this.syncLayoutToCompositor(slug);
      if (destinationIds.includes('youtube')) {
        this.comments.bindForLiveRoom(slug, userId);
      }
      return {
        room: result.room,
        live: result.live,
        resolution: parseResolution(result.resolution),
        destinations: destinationIds,
      };
    } catch (err) {
      await this.dataSource.transaction(async (manager) => {
        await manager.update(Recording, row.id, {
          status: 'failed',
          error: `Failed to start: ${errorMessage(err)}`,
          endedAt: new Date(),
        });
        await manager.update(Room, { id: room.id, status: 'active' }, { status: 'created' });
      });
      throw err;
    }
  }

  /**
   * Explicit stop. Only the owner may end a session, and the room's recording
   * row (not an in-memory map) is the durable source of truth.
   */
  async stop(
    room: Room,
    userId: string,
  ): Promise<{
    room: string;
    file?: string;
    live: boolean;
    downloadUrl?: string;
    s3Key?: string;
    status: RecordingStatus;
    error?: string;
  }> {
    const slug = room.slug;
    if (room.ownerId !== userId) {
      throw new ForbiddenException('only the room owner can stop a session');
    }

    const recording = await this.activeRecording(room.id);
    if (!recording) {
      // Still try compositor stop in case of desync.
      try {
        await this.compositor.stop(slug);
      } catch {
        /* ignore */
      }
      throw new NotFoundException(`no active session for room "${slug}"`);
    }

    await this.recordings.update(recording.id, { status: 'stopping', error: null });

    let result: Awaited<ReturnType<CompositorClient['stop']>>;
    try {
      result = await this.compositor.stop(slug);
    } catch (err) {
      // The media session may still be live; keep the durable state recording and
      // surface the failure so the owner can retry instead of losing the room.
      await this.recordings.update(recording.id, {
        status: 'recording',
        error: `Failed to stop: ${errorMessage(err)}`,
      });
      throw err;
    }

    // The session is over; only now is it safe to tear down live comments.
    this.comments.stopSession(slug);

    const updates: Partial<Recording> = {
      filePath: result.file ?? null,
      endedAt: new Date(),
      status: 'uploading',
    };

    let downloadUrl: string | undefined;
    let s3Key: string | undefined;

    if (result.file && this.s3.isConfigured()) {
      try {
        const stamp =
          result.file.match(/-(\d{4}-\d{2}-\d{2}T.+)\.webm$/)?.[1] ??
          new Date().toISOString().replace(/[:.]/g, '-');
        s3Key = this.s3.objectKey(slug, stamp);
        const urls = await this.s3.createUploadUrls(s3Key);
        await this.compositor.upload(slug, urls.putUrl);
        updates.s3Key = s3Key;
        updates.status = 'finished';
        updates.error = null;
        downloadUrl = urls.downloadUrl;
      } catch (err) {
        this.logger.error(`S3 upload failed for room ${slug}: ${String(err)}`);
        updates.status = 'failed';
        updates.error = `Upload failed: ${errorMessage(err)}`;
      }
    } else {
      updates.status = 'finished';
      updates.error = null;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Recording, recording.id, updates);
      const roomUpdate = await manager.update(
        Room,
        { id: room.id, status: 'active' },
        { status: 'finished' },
      );
      if (roomUpdate.affected !== 1) {
        throw new ConflictException(`room "${slug}" is no longer active`);
      }
    });
    // The room is finished: release its SFU router and participant state so a
    // later room reusing the slug starts from a clean slate.
    await this.cleanupSfuRoom(slug);
    this.logger.log(
      `stopped room=${slug} status=${updates.status} file=${result.file ?? 'none'} s3=${s3Key ?? 'none'}`,
    );
    return {
      room: slug,
      file: result.file,
      live: result.live,
      downloadUrl,
      s3Key,
      status: updates.status ?? 'finished',
      ...(updates.error ? { error: updates.error } : {}),
    };
  }

  /** Durable session snapshot so the owner can restore control after a reconnect. */
  async session(room: Room, userId: string): Promise<SessionState> {
    if (room.ownerId !== userId) {
      throw new ForbiddenException('only the room owner can view the live session');
    }
    return this.sessionView(room);
  }

  /**
   * Public sharing state every member may observe, so non-owners can see when
   * the owner is recording or live without being able to change it.
   */
  async shareState(slug: string): Promise<RoomShareState> {
    const room = await this.rooms.findBySlug(slug);
    const session = await this.sessionView(room);
    return {
      active: session.active,
      live: session.live,
      status: session.status,
      startedAt: session.startedAt,
      destinations: session.destinations,
      error: session.error,
    };
  }

  private async sessionView(room: Room): Promise<SessionState> {
    const latest = await this.recordings.findOne({
      where: { roomId: room.id },
      order: { createdAt: 'DESC' },
    });
    const activeStatus = latest && ACTIVE_RECORDING_STATUSES.includes(latest.status) ? latest.status : null;
    if (!latest || !activeStatus) {
      return {
        room: room.slug,
        roomStatus: room.status,
        active: false,
        live: false,
        status: activeStatus,
        startedAt: null,
        destinations: [],
        error: latest?.error ?? null,
      };
    }
    const active = activeStatus === 'starting' || activeStatus === 'recording';
    return {
      room: room.slug,
      roomStatus: room.status,
      active,
      live: active ? latest.live : false,
      status: activeStatus,
      startedAt: active ? latest.startedAt : null,
      destinations: active ? latest.destinations ?? [] : [],
      error: latest.error,
    };
  }

  async media(room: Room, userId: string): Promise<{ media: RoomMedia | null }> {
    if (room.ownerId !== userId) throw new ForbiddenException('only the room owner can access recorded media');
    const recording = await this.recordings.findOne({ where: { roomId: room.id }, order: { createdAt: 'DESC' } });
    if (!recording) return { media: null };
    const urls = await this.mediaUrls(room, recording, userId);
    return { media: {
      status: recording.status,
      live: recording.live,
      resolution: recording.resolution,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
      durationSeconds: mediaDurationSeconds(recording.startedAt, recording.endedAt),
      error: recording.error,
      file: recording.filePath,
      ...urls,
    } };
  }

  /**
   * Playback/download links for a finished room's output. Cloud storage uses
   * presigned S3 URLs; self-hosted media uses short-lived API-signed URLs that
   * authorize the streaming endpoint without a Bearer header.
   */
  private async mediaUrls(
    room: Room,
    recording: Recording,
    userId: string,
  ): Promise<{ playbackUrl?: string; downloadUrl?: string }> {
    // Only a finalized recording has a stable, playable output. Processing and
    // failed uploads stay explicit states rather than half-playable video.
    if (recording.status !== 'finished') return {};
    const filename = `${room.slug}.webm`;
    if (recording.s3Key && this.s3.isConfigured()) {
      try {
        const [playbackUrl, downloadUrl] = await Promise.all([
          this.s3.createDownloadUrl(recording.s3Key),
          this.s3.createDownloadUrl(recording.s3Key, { filename, download: true }),
        ]);
        return { playbackUrl, downloadUrl };
      } catch (err) {
        this.logger.warn(`media URL signing failed for room ${room.slug}: ${errorMessage(err)}`);
        return {};
      }
    }
    if (!recording.filePath) return {};
    try {
      const info = await stat(resolve(recording.filePath));
      if (!info.isFile()) return {};
    } catch {
      // The local file was purged or the recorder host is not reachable here.
      return {};
    }
    const token = issueMediaToken(room.id, userId);
    const playbackUrl = `/api/rooms/${encodeURIComponent(room.slug)}/media/file?token=${encodeURIComponent(token)}`;
    return { playbackUrl, downloadUrl: `${playbackUrl}&download=1` };
  }

  /** Stream a self-hosted recording after verifying the API-signed media token. */
  async streamMedia(
    room: Room,
    token: string | undefined,
    download: boolean,
    reply: Response,
  ): Promise<void> {
    let payload: MediaTokenPayload;
    try {
      payload = verifyMediaToken(token ?? '');
    } catch {
      throw new ForbiddenException('invalid or expired media link');
    }
    if (payload.roomId !== room.id || payload.userId !== room.ownerId) {
      throw new ForbiddenException('media link does not match this room');
    }
    const recording = await this.recordings.findOne({
      where: { roomId: room.id },
      order: { createdAt: 'DESC' },
    });
    const file = recording?.filePath;
    if (!recording || !file || !file.toLowerCase().endsWith('.webm')) {
      throw new NotFoundException('recorded media is not available');
    }
    let resolved: string;
    try {
      resolved = resolve(file);
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('not a regular file');
    } catch {
      // The recorder host may keep the file locally; a missing/unreadable path is
      // a normal "not available" outcome rather than a server error.
      throw new NotFoundException('recorded media is not available');
    }
    const disposition = download ? 'attachment' : 'inline';
    await sendFile(reply, resolved, {
      headers: {
        'Content-Disposition': `${disposition}; filename="${sanitizeHeaderValue(`${room.slug}.webm`)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  async status(): Promise<unknown> {
    try {
      return await this.compositor.status();
    } catch {
      const rows = await this.recordings.find({ where: { status: In(ACTIVE_RECORDING_STATUSES) } });
      return rows.map((row) => ({ roomId: row.roomId, recordingId: row.id, status: row.status }));
    }
  }

  /** Trigger compositor warmup after a speaker joins the studio. */
  warmupRoom(slug: string, resolution?: string): void {
    const token = this.rooms.issueCompositorJoinToken(slug);
    void this.compositor
      .warmup(slug, { token, resolution })
      .then(async () => {
        // A fresh recorder session starts on the default scene; the room may
        // already have one the owner picked. Layout pushes that arrive before the
        // session exists are dropped, so re-apply it here.
        await this.syncLayoutToCompositor(slug);
      })
      .catch((err) => {
        this.logger.warn(`warmup failed for room ${slug}: ${String(err)}`);
      });
  }

  /** Best-effort: make the recorder match the scene stored on the room. */
  private async syncLayoutToCompositor(slug: string): Promise<void> {
    try {
      await this.compositor.setLayout(slug, await this.rooms.layoutBySlug(slug));
    } catch (err) {
      this.logger.warn(`layout sync failed for room ${slug}: ${String(err)}`);
    }
  }
}

function sendFile(
  reply: Response,
  path: string,
  options: Parameters<Response['sendFile']>[1],
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    reply.sendFile(path, options, (err?: Error) => (err ? reject(err) : resolvePromise()));
  });
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/["\r\n]/g, '');
}
