import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { networkInterfaces } from 'os';
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
  private worker: types.Worker | undefined;
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
    warnIfAnnouncedIpStale();
  }

  onModuleDestroy(): void {
    this.worker?.close();
  }

  private requireWorker(): types.Worker {
    if (!this.worker) throw new Error('mediasoup worker not initialized');
    return this.worker;
  }

  /** One router per room, created lazily. Stored as a promise to avoid a create race. */
  getRouter(room: string): Promise<types.Router> {
    let router = this.routers.get(room);
    if (!router) {
      router = this.requireWorker().createRouter({ mediaCodecs: MEDIA_CODECS });
      this.routers.set(room, router);
    }
    return router;
  }

  async createWebRtcTransport(room: string): Promise<types.WebRtcTransport> {
    const router = await this.getRouter(room);
    const ip = process.env.MEDIASOUP_LISTEN_IP ?? '127.0.0.1';
    const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_IP || undefined;

    // Always advertise loopback too so the headless compositor (on this host via
    // localhost) can ICE even when ANNOUNCED_IP is a LAN address for phones.
    const listenInfos: types.TransportListenInfo[] = [
      { protocol: 'udp', ip, announcedAddress },
      { protocol: 'tcp', ip, announcedAddress },
    ];
    if (ip !== '127.0.0.1') {
      listenInfos.push(
        { protocol: 'udp', ip: '127.0.0.1', announcedAddress: '127.0.0.1' },
        { protocol: 'tcp', ip: '127.0.0.1', announcedAddress: '127.0.0.1' },
      );
    }

    return router.createWebRtcTransport({ listenInfos });
  }
}

function localIPv4s(): string[] {
  const out: string[] = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function warnIfAnnouncedIpStale(): void {
  const announced = process.env.MEDIASOUP_ANNOUNCED_IP;
  if (!announced) return;
  const locals = localIPv4s();
  if (locals.includes(announced)) {
    console.log(`[mediasoup] announced IP ${announced} matches this host (${locals.join(', ')})`);
    return;
  }
  console.warn(
    `[mediasoup] WARNING: MEDIASOUP_ANNOUNCED_IP=${announced} is NOT on this machine. ` +
      `Local IPv4s: ${locals.join(', ') || '(none)'}. ` +
      `WebRTC will stay muted (black compositor) until you restart with the current IP, e.g.\n` +
      `  MEDIASOUP_LISTEN_IP=0.0.0.0 MEDIASOUP_ANNOUNCED_IP=${locals[0] ?? 'YOUR_LAN_IP'} npm run dev`,
  );
}
