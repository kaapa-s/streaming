import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  /** room slug → active recording row id while live/recording */
  private readonly activeIds = new Map<string, string>();

  constructor(
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

    const destinations = resolveDestinations(body);
    for (const dest of destinations) {
      await this.platforms.assertConnected(userId, dest.platform);
    }
    const rtmpUrls = destinations.map((dest) =>
      normalizeOutboundRtmp(dest.streamKey, dest.platform),
    );
    const destinationIds = destinations.map((dest) => dest.platform);

    const resolution = parseResolution(body.resolution);
    const token = this.rooms.issueCompositorJoinToken(slug);

    const row = await this.recordings.save(
      this.recordings.create({
        roomId: room.id,
        status: 'starting',
        resolution,
        startedAt: new Date(),
        filePath: null,
        s3Key: null,
        endedAt: null,
      }),
    );
    this.activeIds.set(slug, row.id);

    try {
      const result = await this.compositor.goLive(slug, {
        rtmpUrls: rtmpUrls.length ? rtmpUrls : undefined,
        resolution,
        token,
      });
      await this.recordings.update(row.id, { status: 'recording' });
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
      await this.recordings.update(row.id, { status: 'failed', endedAt: new Date() });
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

    await this.recordings.update(recordingId, updates);
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
    this.compositor.warmupInBackground(slug, token, resolution);
  }
}
