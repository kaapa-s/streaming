import { Device, detectDevice } from 'mediasoup-client';
import type {
  DtlsParameters,
  IceCandidate,
  IceParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
  Transport,
} from 'mediasoup-client/types';

function createDevice(): Device {
  // detectDevice() does not recognize HeadlessChrome (the server-side
  // recorder), so fall back to the regular Chrome handler.
  const handlerName = detectDevice() ?? 'Chrome111';
  return new Device({ handlerName });
}

export type SfuRole = 'speaker' | 'compositor';

export interface RemotePeer {
  id: string;
  name: string;
  stream: MediaStream;
}

export interface SfuCallbacks {
  /** Fired whenever the set of remote peers or their tracks change. */
  onPeersChanged: (peers: RemotePeer[]) => void;
}

interface ProducerInfo {
  producerId: string;
  peerId: string;
  peerName: string;
  kind: 'audio' | 'video';
}

interface JoinResult {
  peerId: string;
  routerRtpCapabilities: RtpCapabilities;
  producers: ProducerInfo[];
}

interface TransportParams {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

interface ConsumeResult {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
}

interface ProduceResult {
  id: string;
}

type SignalingResponse =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error?: string };

type SignalingEvent =
  | { event: 'newProducer'; data: ProducerInfo }
  | { event: 'peerLeft'; data: { peerId: string } }
  | { event: string; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSignalingMessage(raw: unknown): SignalingResponse | SignalingEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id === 'number') {
    if (raw.ok === true) return { id: raw.id, ok: true, data: raw.data };
    if (raw.ok === false) return { id: raw.id, ok: false, error: typeof raw.error === 'string' ? raw.error : undefined };
    return null;
  }
  if (typeof raw.event === 'string') {
    return { event: raw.event, data: raw.data };
  }
  return null;
}

/**
 * Thin client for our signaling protocol + mediasoup-client.
 * Requests:  { id, method, data } -> { id, ok, data | error }
 * Pushes:    { event: 'newProducer' | 'peerLeft' | 'consumerClosed', data }
 */
export class SfuClient {
  peerId = '';

  private ws: WebSocket | undefined;
  private device = createDevice();
  private sendTransport: Transport | undefined;
  private recvTransport: Transport | undefined;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private peers = new Map<string, RemotePeer>();
  private callbacks: SfuCallbacks;

  constructor(callbacks: SfuCallbacks) {
    this.callbacks = callbacks;
  }

  async join(
    room: string,
    name: string,
    role: SfuRole = 'speaker',
    joinToken?: string,
  ): Promise<void> {
    if (!joinToken) throw new Error('join token required');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws/signaling`);
    const ws = this.ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('signaling connection failed'));
    });
    ws.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.handleMessage(raw);
    };
    ws.onclose = () => {
      for (const { reject } of this.pending.values()) reject(new Error('signaling closed'));
      this.pending.clear();
    };

    const joined = await this.request<JoinResult>('join', { room, name, role, token: joinToken });
    this.peerId = joined.peerId;

    await this.device.load({ routerRtpCapabilities: joined.routerRtpCapabilities });
    this.recvTransport = await this.createTransport('recv');

    for (const producer of joined.producers) {
      await this.consumeProducer(producer);
    }
  }

  /** Publish local tracks (studio only; the compositor never calls this). */
  async publish(stream: MediaStream): Promise<void> {
    this.sendTransport = await this.createTransport('send');
    for (const track of stream.getTracks()) {
      if (track.kind === 'video') {
        // Moderate cap only — enough for 1080p into the compositor without the
        // aggressive transport/simulcast tweaks that previously starved RTP.
        await this.sendTransport.produce({
          track,
          encodings: [{ maxBitrate: 4_000_000 }],
          codecOptions: { videoGoogleStartBitrate: 2000 },
        });
      } else {
        await this.sendTransport.produce({
          track,
          encodings: [{ maxBitrate: 128_000 }],
        });
      }
    }
  }

  close(): void {
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.ws?.close();
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<Transport> {
    const params = await this.request<TransportParams>('createTransport', { direction });
    const transport =
      direction === 'send'
        ? this.device.createSendTransport(params)
        : this.device.createRecvTransport(params);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch(errback);
    });

    transport.on('connectionstatechange', (state) => {
      console.log(`[sfu] ${direction} transport ${state}`);
    });

    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
        this.request<ProduceResult>('produce', { transportId: transport.id, kind, rtpParameters })
          .then(({ id }) => callback({ id }))
          .catch(errback);
      });
    }
    return transport;
  }

  private async consumeProducer(info: ProducerInfo): Promise<void> {
    if (!this.recvTransport) throw new Error('recv transport missing');
    const data = await this.request<ConsumeResult>('consume', {
      transportId: this.recvTransport.id,
      producerId: info.producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });

    let peer = this.peers.get(info.peerId);
    if (!peer) {
      peer = { id: info.peerId, name: info.peerName, stream: new MediaStream() };
      this.peers.set(info.peerId, peer);
    }
    peer.stream.addTrack(consumer.track);

    await this.request('resumeConsumer', { consumerId: data.id });
    this.emitPeers();
  }

  private handleMessage(raw: unknown): void {
    const msg = parseSignalingMessage(raw);
    if (!msg) return;

    if ('id' in msg) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.ok) pending.resolve(msg.data);
      else pending.reject(new Error(msg.error ?? 'request failed'));
      return;
    }

    switch (msg.event) {
      case 'newProducer':
        void this.consumeProducer(msg.data as ProducerInfo).catch((err) =>
          console.error('[sfu] consume failed:', err),
        );
        break;
      case 'peerLeft': {
        const data = msg.data;
        if (isRecord(data) && typeof data.peerId === 'string') {
          this.peers.delete(data.peerId);
          this.emitPeers();
        }
        break;
      }
    }
  }

  private request<T = unknown>(method: string, data: Record<string, unknown>): Promise<T> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error('signaling not connected'));
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      ws.send(JSON.stringify({ id, method, data }));
    });
  }

  private emitPeers(): void {
    this.callbacks.onPeersChanged([...this.peers.values()]);
  }
}
