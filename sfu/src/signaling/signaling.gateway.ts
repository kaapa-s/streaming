import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { verifyJoinToken } from '@streaming/join-token';
import { randomUUID } from 'crypto';
import type { types } from 'mediasoup';
import type { WebSocket } from 'ws';
import { MediasoupService } from '../mediasoup/mediasoup.service';

type PeerRole = 'speaker' | 'compositor';
type MediaSource = 'camera' | 'screen';

type RoomLayout = {
  cameraPreset: 'focus' | 'pip-left' | 'pip-right' | 'grid';
  featuredId: string | null;
  sceneScreenIds: string[];
};

export type RoomState = {
  layout: RoomLayout;
  recording: boolean;
  live: boolean;
};

interface Peer {
  id: string;
  name: string;
  userId: string;
  role: PeerRole;
  canManage: boolean;
  room: string;
  socket: WebSocket;
  transports: Map<string, types.WebRtcTransport>;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
}

export function parseRoomState(input: unknown): RoomState | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as { layout?: unknown; recording?: unknown; live?: unknown };
  if (typeof raw.recording !== 'boolean' || typeof raw.live !== 'boolean') return null;
  if (typeof raw.layout !== 'object' || raw.layout === null) return null;
  const layout = raw.layout as Partial<RoomLayout>;
  const presets = ['focus', 'pip-left', 'pip-right', 'grid'] as const;
  const sceneScreenIds = Array.isArray(layout.sceneScreenIds)
    ? layout.sceneScreenIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  return {
    layout: {
      cameraPreset: presets.includes(layout.cameraPreset as RoomLayout['cameraPreset'])
        ? layout.cameraPreset as RoomLayout['cameraPreset']
        : 'focus',
      featuredId: typeof layout.featuredId === 'string' && layout.featuredId.length > 0 ? layout.featuredId : null,
      sceneScreenIds,
    },
    recording: raw.recording,
    live: raw.live,
  };
}

function resolveMediaSource(appData: unknown): MediaSource {
  if (
    typeof appData === 'object' &&
    appData !== null &&
    'source' in appData &&
    (appData as { source: unknown }).source === 'screen'
  ) {
    return 'screen';
  }
  return 'camera';
}

function producerInfo(member: Peer, producer: types.Producer) {
  return {
    producerId: producer.id,
    peerId: member.id,
    peerName: member.name,
    kind: producer.kind,
    appData: { source: resolveMediaSource(producer.appData) },
  };
}

interface RequestMessage {
  id: number;
  method: string;
  data: Record<string, unknown>;
}

/**
 * JSON protocol over /ws/signaling:
 *   client -> server : { id, method, data }         (request)
 *   server -> client : { id, ok, data | error }     (response)
 *   server -> client : { event, data }              (push: newProducer, peerLeft)
 */
@WebSocketGateway({ path: '/ws/signaling' })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private peers = new Map<WebSocket, Peer>();
  private rooms = new Map<string, Set<Peer>>();
  private roomStates = new Map<string, RoomState>();

  constructor(private readonly mediasoup: MediasoupService) {}

  handleConnection(socket: WebSocket): void {
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let msg: RequestMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof msg.id !== 'number' || typeof msg.method !== 'string') return;
      void this.handleRequest(socket, msg)
        .then((data) => this.send(socket, { id: msg.id, ok: true, data: data ?? {} }))
        .catch((err: Error) => {
          console.error(`[signaling] ${msg.method} failed:`, err.message);
          this.send(socket, { id: msg.id, ok: false, error: err.message });
        });
    });
  }

  async kickUser(roomSlug: string, userId: string): Promise<void> {
    for (const peer of this.rooms.get(roomSlug.trim().toLowerCase()) ?? []) {
      if (peer.userId === userId) {
        peer.socket.close(4003, 'removed from room');
        this.handleDisconnect(peer.socket);
      }
    }
  }

  async closeRoom(roomSlug: string): Promise<void> {
    const room = roomSlug.trim().toLowerCase();
    const peers = [...(this.rooms.get(room) ?? [])];
    for (const peer of peers) {
      peer.socket.close(4004, 'room discarded');
      this.handleDisconnect(peer.socket);
    }
    this.rooms.delete(room);
    this.roomStates.delete(room);
    await this.mediasoup.closeRouter(room);
  }

  handleDisconnect(socket: WebSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);

    for (const transport of peer.transports.values()) transport.close();

    const room = this.rooms.get(peer.room);
    if (room) {
      room.delete(peer);
      if (room.size === 0) {
        this.rooms.delete(peer.room);
        this.roomStates.delete(peer.room);
      } else {
        this.broadcast(peer.room, peer, 'peerLeft', { peerId: peer.id });
      }
    }
    console.log(`[signaling] ${peer.name} (${peer.id}) left room ${peer.room}`);
  }

  private async handleRequest(socket: WebSocket, msg: RequestMessage): Promise<unknown> {
    const { method, data } = msg;

    if (method === 'join') {
      const token = String(data.token ?? '');
      if (!token) throw new Error('join token required');
      const claims = verifyJoinToken(token);
      const room = claims.roomSlug;
      const name = claims.name;
      const role: PeerRole = claims.role;
      if (role === 'speaker' && claims.inScene !== true) {
        throw new Error('participant is not admitted to the scene');
      }
      const existingPeers = this.rooms.get(room);
      if (role === 'speaker' && existingPeers && [...existingPeers].filter((peer) => peer.role === 'speaker').length >= 10) {
        throw new Error('scene is full');
      }
      if (data.room != null && String(data.room) !== room) {
        throw new Error('join token room mismatch');
      }
      if (data.role != null && data.role !== role) {
        throw new Error('join token role mismatch');
      }
      const router = await this.mediasoup.getRouter(room);

      const peer: Peer = {
        id: randomUUID(),
        name,
        userId: claims.userId,
        role,
        canManage: claims.canManage === true,
        room,
        socket,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      this.peers.set(socket, peer);

      const members = this.rooms.get(room) ?? new Set<Peer>();
      const producers = [...members].flatMap((member) =>
        [...member.producers.values()].map((producer) => producerInfo(member, producer)),
      );
      members.add(peer);
      this.rooms.set(room, members);

      console.log(`[signaling] ${name} (${peer.id}, ${role}) joined room ${room}`);
      return {
        peerId: peer.id,
        routerRtpCapabilities: router.rtpCapabilities,
        producers,
        roomState: this.roomStates.get(room) ?? null,
      };
    }

    const peer = this.peers.get(socket);
    if (!peer) throw new Error('join first');

    switch (method) {
      case 'roomState': {
        if (!peer.canManage) throw new Error('only the room owner can publish room state');
        const state = parseRoomState(data);
        if (!state) throw new Error('invalid room state');
        this.roomStates.set(peer.room, state);
        this.broadcast(peer.room, peer, 'roomState', state);
        return state;
      }

      case 'createTransport': {
        const transport = await this.mediasoup.createWebRtcTransport(peer.room);
        peer.transports.set(transport.id, transport);
        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      }

      case 'connectTransport': {
        const transport = peer.transports.get(String(data.transportId));
        if (!transport) throw new Error('unknown transport');
        await transport.connect({ dtlsParameters: data.dtlsParameters as types.DtlsParameters });
        return {};
      }

      case 'produce': {
        const transport = peer.transports.get(String(data.transportId));
        if (!transport) throw new Error('unknown transport');
        const source = resolveMediaSource(data.appData);
        const producer = await transport.produce({
          kind: data.kind as types.MediaKind,
          rtpParameters: data.rtpParameters as types.RtpParameters,
          appData: { source },
        });
        peer.producers.set(producer.id, producer);
        producer.on('transportclose', () => {
          peer.producers.delete(producer.id);
        });
        this.broadcast(peer.room, peer, 'newProducer', producerInfo(peer, producer));
        console.log(
          `[signaling] ${peer.name} (${peer.id}) produced ${producer.kind}/${resolveMediaSource(data.appData)} ` +
            `producer=${producer.id} in room ${peer.room}`,
        );
        return { id: producer.id };
      }

      case 'closeProducer': {
        const producerId = String(data.producerId);
        const producer = peer.producers.get(producerId);
        if (!producer) throw new Error('unknown producer');
        producer.close();
        peer.producers.delete(producerId);
        return {};
      }

      case 'consume': {
        const transport = peer.transports.get(String(data.transportId));
        if (!transport) throw new Error('unknown transport');
        const router = await this.mediasoup.getRouter(peer.room);
        const producerId = String(data.producerId);
        const rtpCapabilities = data.rtpCapabilities as types.RtpCapabilities;
        if (!router.canConsume({ producerId, rtpCapabilities })) {
          throw new Error('cannot consume producer');
        }
        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });
        peer.consumers.set(consumer.id, consumer);
        console.log(
          `[signaling] ${peer.name} (${peer.id}) consuming producer=${producerId} ` +
            `consumer=${consumer.id} in room ${peer.room}`,
        );
        consumer.on('producerclose', () => {
          peer.consumers.delete(consumer.id);
          this.send(peer.socket, { event: 'consumerClosed', data: { consumerId: consumer.id } });
        });
        return {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };
      }

      case 'resumeConsumer': {
        const consumer = peer.consumers.get(String(data.consumerId));
        if (!consumer) throw new Error('unknown consumer');
        await consumer.resume();
        return {};
      }

      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  private broadcast(room: string, sender: Peer, event: string, data: unknown): void {
    for (const peer of this.rooms.get(room) ?? []) {
      if (peer !== sender) this.send(peer.socket, { event, data });
    }
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }
}
