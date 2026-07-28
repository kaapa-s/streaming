import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';

const MEDIA_CODECS: types.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    preferredPayloadType: 96,
    clockRate: 90000,
  },
];

@Injectable()
export class MediasoupService implements OnModuleInit, OnModuleDestroy {
  private worker!: types.Worker;
  private routers = new Map<string, Promise<types.Router>>();

  async onModuleInit(): Promise<void> {
    this.worker = await mediasoup.createWorker({
      rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT ?? 40000),
      rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT ?? 40100),
    });
    this.worker.on('died', () => {
      console.error('[mediasoup] worker died, exiting');
      process.exit(1);
    });
    console.log(`[mediasoup] worker started (pid ${this.worker.pid})`);
  }

  onModuleDestroy(): void {
    this.worker?.close();
  }

  /** One router per room, created lazily. Stored as a promise to avoid a create race. */
  getRouter(room: string): Promise<types.Router> {
    let router = this.routers.get(room);
    if (!router) {
      router = this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
      this.routers.set(room, router);
    }
    return router;
  }

  async createWebRtcTransport(room: string): Promise<types.WebRtcTransport> {
    const router = await this.getRouter(room);
    const ip = process.env.MEDIASOUP_LISTEN_IP ?? '127.0.0.1';
    const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_IP || undefined;
    return router.createWebRtcTransport({
      listenInfos: [
        { protocol: 'udp', ip, announcedAddress },
        { protocol: 'tcp', ip, announcedAddress },
      ],
    });
  }
}
