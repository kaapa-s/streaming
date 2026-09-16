import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CommentsService } from '../comments/comments.service';
import { Recording, Room } from '../entities';
import type { PlatformProvider } from '../platforms/platform-ids';
import { PlatformConnectionStore } from '../platforms/platform-connection.store';
import { normalizeOutboundRtmp } from '../platforms/outbound-rtmp';
import { RoomsService } from '../rooms/rooms.service';
import { CompositorClient } from './compositor.client';
import { resolveDestinations } from './destinations';
import type { StartRecordingDto } from './recordings.dto';
import { S3PresignService } from './s3-presign.service';
import { parseResolution, type StreamResolution } from '@streaming/stream-quality';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  /** room slug → active recording row id while live/recording */
  private readonly activeIds = new Map<string, string>();

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
    if (this.activeIds.has(slug)) {
      throw new BadRequestException(`already recording room "${slug}"`);
    }

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
          throw new ForbiddenException('only the room owner can start recording');
        }
        if (lockedRoom.status !== 'created') {
          throw new ConflictException(
            `room "${slug}" cannot be activated from status "${lockedRoom.status}"`,
          );
        }

        const recording = manager.create(Recording, {
          roomId: lockedRoom.id,
          status: 'starting',
          resolution,
          startedAt: new Date(),
          filePath: null,
          s3Key: null,
          endedAt: null,
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
    this.activeIds.set(slug, row.id);

    try {
      const result = await this.compositor.goLive(slug, {
        rtmpUrls: rtmpUrls.length ? rtmpUrls : undefined,
        resolution,
        token,
      });
      await this.recordings.update(row.id, { status: 'recording' });
      await this.syncLayoutToCompositor(slug);
      if (destinationIds.includes('youtube')) {
        this.comments.bindForLiveRoom(slug, room.ownerId);
      }
      return {
        room: result.room,
        live: result.live,
        resolution: parseResolution(result.resolution),
        destinations: destinationIds,
      };
    } catch (err) {
      this.activeIds.delete(slug);
      await this.dataSource.transaction(async (manager) => {
        await manager.update(Recording, row.id, { status: 'failed', endedAt: new Date() });
        await manager.update(Room, { id: room.id, status: 'active' }, { status: 'created' });
      });
      throw err;
    }
  }

  async stop(
    room: Room,
  ): Promise<{ room: string; file?: string; live: boolean; downloadUrl?: string; s3Key?: string }> {
    const slug = room.slug;
    this.comments.stopSession(slug);
    const recordingId = this.activeIds.get(slug);
    if (!recordingId) {
      // Still try compositor stop in case of desync.
      try {
        await this.compositor.stop(slug);
      } catch {
        /* ignore */
      }
      throw new NotFoundException(`no active recording for room "${slug}"`);
    }
    this.activeIds.delete(slug);

    await this.recordings.update(recordingId, { status: 'uploading' });

    const result = await this.compositor.stop(slug);
    const updates: Partial<Recording> = {
      filePath: result.file ?? null,
      endedAt: new Date(),
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
        updates.status = 'stopped';
        downloadUrl = urls.downloadUrl;
      } catch (err) {
        this.logger.error(`S3 upload failed for room ${slug}: ${String(err)}`);
        updates.status = 'stopped';
      }
    } else {
      updates.status = 'stopped';
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Recording, recordingId, updates);
      const roomUpdate = await manager.update(
        Room,
        { id: room.id, status: 'active' },
        { status: 'finished' },
      );
      if (roomUpdate.affected !== 1) {
        throw new ConflictException(`room "${slug}" is no longer active`);
      }
    });
    this.logger.log(
      `stopped room=${slug} file=${result.file ?? 'none'} s3=${s3Key ?? 'none'}`,
    );
    return {
      room: slug,
      file: result.file,
      live: result.live,
      downloadUrl,
      s3Key,
    };
  }

  async media(room: Room, userId: string): Promise<{
    status: string;
    startedAt: Date | null;
    endedAt: Date | null;
    file: string | null;
    downloadUrl?: string;
  } | null> {
    if (room.ownerId !== userId) throw new ForbiddenException('only the room owner can access recorded media');
    const recording = await this.recordings.findOne({ where: { roomId: room.id }, order: { createdAt: 'DESC' } });
    if (!recording) return null;
    const downloadUrl = recording.s3Key && this.s3.isConfigured()
      ? await this.s3.createDownloadUrl(recording.s3Key)
      : undefined;
    return {
      status: recording.status, startedAt: recording.startedAt, endedAt: recording.endedAt,
      file: recording.filePath, ...(downloadUrl ? { downloadUrl } : {}),
    };
  }

  async status(): Promise<unknown> {
    try {
      return await this.compositor.status();
    } catch {
      return [...this.activeIds.entries()].map(([room, id]) => ({ room, recordingId: id }));
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
