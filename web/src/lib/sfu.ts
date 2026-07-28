import { Device, detectDevice } from 'mediasoup-client';
import type { Transport } from 'mediasoup-client/types';

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

/**
 * Thin client for our signaling protocol + mediasoup-client.
 * Requests:  { id, method, data } -> { id, ok, data | error }
 * Pushes:    { event: 'newProducer' | 'peerLeft' | 'consumerClosed', data }
 */
export class SfuClient {
  peerId = '';

  private ws!: WebSocket;
  private device = createDevice();
  private sendTransport?: Transport;
  private recvTransport?: Transport;
  private nextRequestId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private peers = new Map<string, RemotePeer>();
  private callbacks: SfuCallbacks;

  constructor(callbacks: SfuCallbacks) {
    this.callbacks = callbacks;
  }

  async join(room: string, name: string, role: SfuRole = 'speaker'): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws/signaling`);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('signaling connection failed'));
    });
    this.ws.onmessage = (ev) => this.handleMessage(JSON.parse(ev.data));
    this.ws.onclose = () => {
      for (const { reject } of this.pending.values()) reject(new Error('signaling closed'));
      this.pending.clear();
    };

    const joined = await this.request('join', { room, name, role });
    this.peerId = joined.peerId;

    await this.device.load({ routerRtpCapabilities: joined.routerRtpCapabilities });
    this.recvTransport = await this.createTransport('recv');

    for (const producer of joined.producers as ProducerInfo[]) {
      await this.consumeProducer(producer);
    }
  }

  /** Publish local tracks (studio only; the compositor never calls this). */
  async publish(stream: MediaStream): Promise<void> {
    this.sendTransport = await this.createTransport('send');
    for (const track of stream.getTracks()) {
      await this.sendTransport.produce({ track });
    }
  }

  close(): void {
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.ws?.close();
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<Transport> {
    const params = await this.request('createTransport', { direction });
    const transport =
      direction === 'send'
        ? this.device.createSendTransport(params)
        : this.device.createRecvTransport(params);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch(errback);
    });

    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
        this.request('produce', { transportId: transport.id, kind, rtpParameters })
          .then(({ id }) => callback({ id }))
          .catch(errback);
      });
    }
    return transport;
  }

  private async consumeProducer(info: ProducerInfo): Promise<void> {
    if (!this.recvTransport) throw new Error('recv transport missing');
    const data = await this.request('consume', {
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

  private handleMessage(msg: any): void {
    if (typeof msg.id === 'number') {
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
      case 'peerLeft':
        this.peers.delete(msg.data.peerId);
        this.emitPeers();
        break;
    }
  }

  private request(method: string, data: Record<string, unknown>): Promise<any> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, data }));
    });
  }

  private emitPeers(): void {
    this.callbacks.onPeersChanged([...this.peers.values()]);
  }
}
