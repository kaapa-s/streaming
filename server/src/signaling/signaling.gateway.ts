import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import type { types } from 'mediasoup';
import type { WebSocket } from 'ws';
import { MediasoupService } from '../mediasoup/mediasoup.service';

type PeerRole = 'speaker' | 'compositor';

interface Peer {
  id: string;
  name: string;
  role: PeerRole;
  room: string;
  socket: WebSocket;
  transports: Map<string, types.WebRtcTransport>;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
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

  handleDisconnect(socket: WebSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);

    for (const transport of peer.transports.values()) transport.close();

    const room = this.rooms.get(peer.room);
    if (room) {
      room.delete(peer);
      if (room.size === 0) this.rooms.delete(peer.room);
      else this.broadcast(peer.room, peer, 'peerLeft', { peerId: peer.id });
    }
    console.log(`[signaling] ${peer.name} (${peer.id}) left room ${peer.room}`);
  }

  private async handleRequest(socket: WebSocket, msg: RequestMessage): Promise<unknown> {
    const { method, data } = msg;

    if (method === 'join') {
      const room = String(data.room ?? 'main');
      const name = String(data.name ?? 'anonymous');
      const role: PeerRole = data.role === 'compositor' ? 'compositor' : 'speaker';
      const router = await this.mediasoup.getRouter(room);

      const peer: Peer = {
        id: randomUUID(),
        name,
        role,
        room,
        socket,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      this.peers.set(socket, peer);

      const members = this.rooms.get(room) ?? new Set<Peer>();
      const producers = [...members].flatMap((member) =>
        [...member.producers.values()].map((producer) => ({
          producerId: producer.id,
          peerId: member.id,
          peerName: member.name,
          kind: producer.kind,
        })),
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
        const producer = await transport.produce({
          kind: data.kind as types.MediaKind,
          rtpParameters: data.rtpParameters as types.RtpParameters,
        });
        peer.producers.set(producer.id, producer);
        this.broadcast(peer.room, peer, 'newProducer', {
          producerId: producer.id,
          peerId: peer.id,
          peerName: peer.name,
          kind: producer.kind,
        });
        return { id: producer.id };
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
