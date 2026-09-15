import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { verifyJoinToken } from '@streaming/join-token';
import { randomUUID } from 'crypto';
import type { types } from 'mediasoup';
import type { WebSocket } from 'ws';
import { MediasoupService } from '../mediasoup/mediasoup.service';
import { RoomBans } from './room-bans';

type PeerRole = 'speaker' | 'compositor';
type MediaSource = 'camera' | 'screen';

interface Peer {
  id: string;
  userId: string;
  name: string;
  role: PeerRole;
  /** Room owner: may kick others and close the room. Carried by the join token. */
  canManage: boolean;
  room: string;
  socket: WebSocket;
  transports: Map<string, types.WebRtcTransport>;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
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
    userId: member.userId,
    kind: producer.kind,
    appData: { source: resolveMediaSource(producer.appData) },
  };
}

interface RequestMessage {
  id: number;
  method: string;
  data: Record<string, unknown>;
}

const BAN_PRUNE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * JSON protocol over /ws/signaling:
 *   client -> server : { id, method, data }         (request)
 *   server -> client : { id, ok, data | error }     (response)
 *   server -> client : { event, data }              (push: newProducer, peerLeft, kicked)
 */
@WebSocketGateway({ path: '/ws/signaling' })
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private peers = new Map<WebSocket, Peer>();
  private rooms = new Map<string, Set<Peer>>();
  private bans = new RoomBans();
  private pruneTimer?: NodeJS.Timeout;

  constructor(private readonly mediasoup: MediasoupService) {}

  onModuleInit(): void {
    this.pruneTimer = setInterval(() => this.bans.prune(), BAN_PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = undefined;
  }

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

  handleDisconnect(socket: WebSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.dropPeer(peer);
  }

  private dropPeer(peer: Peer, reason?: string): void {
    if (!this.peers.delete(peer.socket)) return;

    for (const transport of peer.transports.values()) transport.close();

    const room = this.rooms.get(peer.room);
    if (room) {
      room.delete(peer);
      if (room.size === 0) this.rooms.delete(peer.room);
      else this.broadcast(peer.room, peer, 'peerLeft', { peerId: peer.id });
    }
    if (peer.socket.readyState === peer.socket.OPEN) peer.socket.close();
    console.log(
      `[signaling] ${peer.name} (${peer.id}) left room ${peer.room}` +
        (reason ? ` — ${reason}` : ''),
    );
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
      if (data.room != null && String(data.room) !== room) {
        throw new Error('join token room mismatch');
      }
      if (data.role != null && data.role !== role) {
        throw new Error('join token role mismatch');
      }

      // The API is the authority on both of these, but it has no channel to this
      // process — so a token issued before the room ended, or before its holder
      // was kicked, would still open a session. These cover that window; the
      // token's own short TTL closes it for good.
      if (this.bans.isClosed(room)) throw new Error('room closed');
      if (role === 'speaker' && this.bans.isBanned(room, claims.userId)) {
        throw new Error('removed from this room');
      }

      const router = await this.mediasoup.getRouter(room);

      // One speaker per user per room. A second tab / HMR remount publishes
      // the same mic under a new peerId; other clients treat it as remote and
      // play it — instant feedback (you hear yourself typing).
      if (role === 'speaker') {
        for (const prev of [...(this.rooms.get(room) ?? [])]) {
          if (prev.role !== 'speaker' || prev.userId !== claims.userId) continue;
          if (prev.socket === socket) continue;
          this.dropPeer(prev, 'replaced by new speaker session');
        }
      }

      const peer: Peer = {
        id: randomUUID(),
        userId: claims.userId,
        name,
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
      };
    }

    const peer = this.peers.get(socket);
    if (!peer) throw new Error('join first');

    switch (method) {
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

      // Kicks by userId, not peerId: one person can hold several sockets (a
      // second tab, a reconnect mid-kick), and userId is the key the API's
      // durable removal uses too.
      case 'kickPeer': {
        if (!peer.canManage) throw new Error('not allowed');
        const userId = String(data.userId ?? '');
        if (!userId) throw new Error('userId required');
        if (userId === peer.userId) throw new Error('cannot kick yourself');

        this.bans.ban(peer.room, userId);
        let kicked = 0;
        for (const target of [...(this.rooms.get(peer.room) ?? [])]) {
          if (target.role !== 'speaker' || target.userId !== userId) continue;
          this.send(target.socket, {
            event: 'kicked',
            data: { reason: 'removed by host' },
          });
          this.dropPeer(target, 'kicked by owner');
          kicked += 1;
        }
        return { kicked };
      }

      // Ends the room at the media layer. Drops the compositor too — it is a
      // peer like any other, and leaving it consuming an empty room would hold
      // its Chromium slot open.
      case 'closeRoom': {
        if (!peer.canManage) throw new Error('not allowed');
        const room = peer.room;
        this.bans.close(room);
        let dropped = 0;
        for (const target of [...(this.rooms.get(room) ?? [])]) {
          if (target !== peer) {
            this.send(target.socket, {
              event: 'kicked',
              data: { reason: 'the host ended this stream' },
            });
          }
          this.dropPeer(target, 'room closed by owner');
          dropped += 1;
        }
        return { dropped };
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
