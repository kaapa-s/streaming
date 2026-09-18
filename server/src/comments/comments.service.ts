import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/jwt.strategy';
import { YoutubeOAuthService } from '../platforms/youtube-oauth.service';
import { CompositorClient } from '../recordings/compositor.client';
import { RoomsService } from '../rooms/rooms.service';
import type {
  ChatBindStatus,
  CommentCapabilities,
  CommentOverlayPayload,
  NormalizedComment,
  PlatformId,
} from './types';
import { LiveChatEndedError } from './types';
import { YoutubeLiveChatAdapter } from './youtube-live-chat.adapter';

const OVERLAY_TTL_MS = 10_000;
const MAX_BUFFERED_COMMENTS = 200;

interface RoomChatSession {
  roomSlug: string;
  ownerUserId: string;
  chatId?: string;
  bindStatus: ChatBindStatus;
  title?: string;
  videoId?: string;
  pageToken?: string;
  subscribers: Set<(event: MessageEvent) => void>;
  comments: NormalizedComment[];
  seenIds: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  polling: boolean;
  bindGeneration: number;
}

function httpMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    if (typeof res === 'string') return res;
    if (typeof res === 'object' && res && 'message' in res) {
      const msg = (res as { message: string | string[] }).message;
      return Array.isArray(msg) ? msg.join(', ') : msg;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

function isYoutubeDisconnected(err: unknown): boolean {
  return httpMessage(err).includes('YouTube is not connected');
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);
  private readonly sessions = new Map<string, RoomChatSession>();

  /** Tunable for unit tests. */
  bindDeadlineMs = 120_000;
  bindBackoffMs = [2_000, 5_000, 10_000];
  bindSlowRetryMs = 15_000;
  sleepFn = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  constructor(
    @Inject(RoomsService)
    private readonly rooms: {
      requireMembershipBySlug(
        slug: string,
        userId: string,
      ): Promise<{ room: { slug: string; ownerId: string }; member: { role: string } }>;
    },
    @Inject(YoutubeOAuthService)
    private readonly youtubeOAuth: Pick<YoutubeOAuthService, 'getValidAccessToken'>,
    // Only YouTube is wired today; the service talks to it through the
    // provider-neutral LiveChatAdapter surface.
    private readonly chatProvider: YoutubeLiveChatAdapter,
    @Inject(CompositorClient)
    private readonly compositor: Pick<CompositorClient, 'setOverlay'>,
  ) {}

  /**
   * Any room participant may view and moderate comments; there is no separate
   * moderator role. Provider specifics stop at the adapter boundary.
   */
  private async requireParticipant(slug: string, user: AuthUser) {
    const { room } = await this.rooms.requireMembershipBySlug(slug, user.id);
    return room;
  }

  provider(): PlatformId {
    return this.chatProvider.provider;
  }

  capabilities(): CommentCapabilities {
    return this.chatProvider.capabilities();
  }

  private requireCapability(action: keyof CommentCapabilities): void {
    if (this.chatProvider.capabilities()[action]) return;
    throw new BadRequestException(
      `${this.chatProvider.provider} does not support ${action} for live comments`,
    );
  }

  sessionBindStatus(slug: string): ChatBindStatus | undefined {
    return this.sessions.get(slug.trim().toLowerCase())?.bindStatus;
  }

  /**
   * Create a connecting session immediately and retry YouTube until a live chat id
   * appears. Safe to call more than once; does not block go-live.
   */
  bindForLiveRoom(slug: string, ownerUserId: string): void {
    const key = slug.trim().toLowerCase();
    const existing = this.sessions.get(key);
    if (existing?.bindStatus === 'active' && existing.chatId) {
      existing.ownerUserId = ownerUserId;
      return;
    }

    const session = existing ?? this.createConnectingSession(key, ownerUserId);
    session.ownerUserId = ownerUserId;
    if (!existing) this.sessions.set(key, session);
    if (session.bindStatus === 'connecting' && existing) {
      return;
    }
    session.bindStatus = 'connecting';
    const generation = session.bindGeneration + 1;
    session.bindGeneration = generation;
    void this.runBindLoop(session, generation);
  }

  async startSession(
    slug: string,
    user: AuthUser,
  ): Promise<{
    status: ChatBindStatus;
    chatId?: string;
    title?: string;
    videoId?: string;
    provider: PlatformId;
    capabilities: CommentCapabilities;
  }> {
    const room = await this.requireParticipant(slug, user);
    const session = this.sessions.get(room.slug);
    // The broadcast (and its provider credentials) belongs to the room owner, so
    // any participant observes/moderates through the owner's bound session.
    const ownerUserId = session?.ownerUserId ?? room.ownerId;
    await this.youtubeOAuth.getValidAccessToken(ownerUserId);
    this.bindForLiveRoom(room.slug, ownerUserId);
    const bound = this.sessions.get(room.slug);
    if (!bound) {
      throw new BadRequestException('YouTube is not connected');
    }
    return {
      status: bound.bindStatus,
      chatId: bound.chatId,
      title: bound.title,
      videoId: bound.videoId,
      provider: this.provider(),
      capabilities: this.capabilities(),
    };
  }

  streamComments(slug: string, user: AuthUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let detach: (() => void) | undefined;
      let cancelled = false;

      void this.attachSubscriber(
        slug,
        user,
        (event) => {
          if (!cancelled) subscriber.next(event);
        },
        (err) => {
          if (!cancelled) subscriber.error(err);
        },
      ).then((d) => {
        if (cancelled) {
          d();
          return;
        }
        detach = d;
      });

      return () => {
        cancelled = true;
        detach?.();
      };
    });
  }

  private async attachSubscriber(
    slug: string,
    user: AuthUser,
    push: (event: MessageEvent) => void,
    fail: (err: unknown) => void,
  ): Promise<() => void> {
    try {
      const room = await this.requireParticipant(slug, user);
      const session = this.sessions.get(room.slug);
      if (!session) {
        fail(
          new BadRequestException(
            'No comments session — YouTube chat is still connecting',
          ),
        );
        return () => undefined;
      }

      const handler = (event: MessageEvent) => push(event);
      session.subscribers.add(handler);

      this.pushStatus(session, push);
      const snapshot: MessageEvent = {
        type: 'snapshot',
        data: JSON.stringify({ comments: session.comments }),
      };
      push(snapshot);

      return () => {
        session.subscribers.delete(handler);
      };
    } catch (err) {
      fail(err);
      return () => undefined;
    }
  }

  async reply(slug: string, user: AuthUser, text: string): Promise<NormalizedComment> {
    const room = await this.requireParticipant(slug, user);
    this.requireCapability('reply');
    const session = this.sessions.get(room.slug);
    if (!session) {
      throw new BadRequestException('No active comments session');
    }
    if (!session.chatId) {
      throw new ServiceUnavailableException('YouTube chat is still connecting');
    }
    const accessToken = await this.youtubeOAuth.getValidAccessToken(session.ownerUserId);
    const comment = await this.chatProvider.postReply(accessToken, session.chatId, text);
    this.ingestComments(session, [comment]);
    return comment;
  }

  /** Delete/hide a single comment. */
  async removeComment(slug: string, user: AuthUser, commentId: string): Promise<{ ok: true }> {
    const room = await this.requireParticipant(slug, user);
    this.requireCapability('remove');
    const session = this.requireLiveSession(room.slug);
    const remove = this.chatProvider.removeComment;
    if (!remove) {
      throw new BadRequestException(
        `${this.chatProvider.provider} does not support removing comments`,
      );
    }
    const accessToken = await this.youtubeOAuth.getValidAccessToken(session.ownerUserId);
    await remove.call(this.chatProvider, accessToken, session.chatId as string, commentId);
    this.dropComments(session, (c) => c.id === commentId);
    this.broadcast(session, {
      type: 'removed',
      data: JSON.stringify({ id: commentId }),
    });
    return { ok: true };
  }

  /**
   * Ban or time out a comment author. `durationSeconds` omitted means a permanent
   * ban where the provider distinguishes the two.
   */
  async banAuthor(
    slug: string,
    user: AuthUser,
    authorId: string,
    durationSeconds?: number,
  ): Promise<{ ok: true }> {
    const room = await this.requireParticipant(slug, user);
    this.requireCapability('ban');
    const session = this.requireLiveSession(room.slug);
    const ban = this.chatProvider.banAuthor;
    if (!ban) {
      throw new BadRequestException(
        `${this.chatProvider.provider} does not support banning comment authors`,
      );
    }
    const accessToken = await this.youtubeOAuth.getValidAccessToken(session.ownerUserId);
    await ban.call(this.chatProvider, accessToken, session.chatId as string, authorId, durationSeconds);
    this.dropComments(session, (c) => c.authorId === authorId);
    this.broadcast(session, {
      type: 'banned',
      data: JSON.stringify({ authorId }),
    });
    return { ok: true };
  }

  private requireLiveSession(roomSlug: string): RoomChatSession {
    const session = this.sessions.get(roomSlug);
    if (!session) {
      throw new BadRequestException('No active comments session');
    }
    if (!session.chatId) {
      throw new ServiceUnavailableException('YouTube chat is still connecting');
    }
    return session;
  }

  /** Drop buffered comments matching a predicate and let subscribers prune them. */
  private dropComments(session: RoomChatSession, match: (c: NormalizedComment) => boolean): void {
    const kept: NormalizedComment[] = [];
    for (const c of session.comments) {
      if (match(c)) session.seenIds.delete(c.id);
      else kept.push(c);
    }
    session.comments = kept;
  }

  async setOverlay(
    slug: string,
    user: AuthUser,
    comment: { author: string; text: string } | null,
  ): Promise<{ ok: true; overlay: CommentOverlayPayload | null }> {
    await this.requireParticipant(slug, user);
    if (comment) this.requireCapability('pin');
    const overlay: CommentOverlayPayload | null = comment
      ? {
          author: comment.author,
          text: comment.text,
          until: Date.now() + OVERLAY_TTL_MS,
        }
      : null;

    try {
      await this.compositor.setOverlay(slug, overlay);
    } catch (err) {
      this.logger.warn(`compositor overlay failed for ${slug}: ${String(err)}`);
      if (overlay) throw err;
    }
    return { ok: true, overlay };
  }

  stopSession(slug: string): void {
    const key = slug.trim().toLowerCase();
    const session = this.sessions.get(key);
    if (!session) return;
    session.bindGeneration += 1;
    if (session.timer) clearTimeout(session.timer);
    this.sessions.delete(key);
  }

  private createConnectingSession(roomSlug: string, ownerUserId: string): RoomChatSession {
    return {
      roomSlug,
      ownerUserId,
      bindStatus: 'connecting',
      subscribers: new Set(),
      comments: [],
      seenIds: new Set(),
      polling: false,
      bindGeneration: 0,
    };
  }

  private async runBindLoop(session: RoomChatSession, generation: number): Promise<void> {
    const startedAt = Date.now();
    let delayIndex = 0;
    let markedFailed = false;

    while (
      this.sessions.get(session.roomSlug) === session &&
      session.bindGeneration === generation
    ) {
      try {
        const accessToken = await this.youtubeOAuth.getValidAccessToken(session.ownerUserId);
        const resolved = await this.chatProvider.resolveChatSession({ accessToken });
        if (
          this.sessions.get(session.roomSlug) !== session ||
          session.bindGeneration !== generation
        ) {
          return;
        }
        session.chatId = resolved.chatId;
        session.title = resolved.title;
        session.videoId = resolved.videoId;
        session.bindStatus = 'active';
        session.pageToken = undefined;
        this.broadcastStatus(session);
        this.schedulePoll(session, 0);
        return;
      } catch (err) {
        if (isYoutubeDisconnected(err)) {
          this.logger.log(`skip comments bind for ${session.roomSlug}: YouTube not connected`);
          if (session.bindGeneration === generation) this.stopSession(session.roomSlug);
          return;
        }
        this.logger.warn(`comments bind room=${session.roomSlug}: ${httpMessage(err)}`);
      }

      const elapsed = Date.now() - startedAt;
      if (!markedFailed && elapsed >= this.bindDeadlineMs) {
        markedFailed = true;
        session.bindStatus = 'failed';
        this.broadcast(session, {
          type: 'error',
          data: JSON.stringify({
            message: 'Still waiting for YouTube to mark the broadcast live',
          }),
        });
        this.broadcastStatus(session);
      }

      const delay =
        markedFailed || elapsed >= this.bindDeadlineMs
          ? this.bindSlowRetryMs
          : this.bindBackoffMs[Math.min(delayIndex, this.bindBackoffMs.length - 1)];
      delayIndex += 1;
      await this.sleepFn(delay);
    }
  }

  private schedulePoll(session: RoomChatSession, delayMs: number): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      void this.pollOnce(session);
    }, Math.max(0, delayMs));
  }

  private async pollOnce(session: RoomChatSession): Promise<void> {
    if (!this.sessions.has(session.roomSlug)) return;
    if (!session.chatId) return;
    if (session.polling) {
      this.schedulePoll(session, 1000);
      return;
    }
    session.polling = true;
    let nextDelay = 5000;
    try {
      const accessToken = await this.youtubeOAuth.getValidAccessToken(session.ownerUserId);
      const result = await this.chatProvider.pollComments(
        accessToken,
        session.chatId,
        session.pageToken,
      );
      session.pageToken = result.nextPageToken ?? session.pageToken;
      nextDelay = result.pollingIntervalMs;
      this.ingestComments(session, result.comments);
    } catch (err) {
      if (err instanceof LiveChatEndedError) {
        this.logger.log(`live chat ended room=${session.roomSlug}`);
        this.stopSession(session.roomSlug);
        return;
      }
      this.logger.warn(`poll failed room=${session.roomSlug}: ${httpMessage(err)}`);
      session.pageToken = undefined;
      this.broadcast(session, {
        type: 'error',
        data: JSON.stringify({
          message: httpMessage(err),
        }),
      });
      nextDelay = 10_000;
    } finally {
      session.polling = false;
      if (this.sessions.has(session.roomSlug) && session.chatId) {
        this.schedulePoll(session, nextDelay);
      }
    }
  }

  private ingestComments(session: RoomChatSession, incoming: NormalizedComment[]): void {
    const fresh: NormalizedComment[] = [];
    for (const c of incoming) {
      if (session.seenIds.has(c.id)) continue;
      session.seenIds.add(c.id);
      session.comments.push(c);
      fresh.push(c);
    }
    if (session.comments.length > MAX_BUFFERED_COMMENTS) {
      const drop = session.comments.length - MAX_BUFFERED_COMMENTS;
      const removed = session.comments.splice(0, drop);
      for (const r of removed) session.seenIds.delete(r.id);
    }
    if (fresh.length > 0) {
      this.broadcast(session, {
        type: 'comments',
        data: JSON.stringify({ comments: fresh }),
      });
    }
  }

  private pushStatus(session: RoomChatSession, push: (event: MessageEvent) => void): void {
    const event: MessageEvent = {
      type: 'status',
      data: JSON.stringify({
        bindStatus: session.bindStatus,
        title: session.title,
        provider: this.provider(),
        capabilities: this.capabilities(),
      }),
    };
    push(event);
  }

  private broadcastStatus(session: RoomChatSession): void {
    this.pushStatus(session, (event) => this.broadcast(session, event));
  }

  private broadcast(session: RoomChatSession, event: MessageEvent): void {
    for (const sub of session.subscribers) {
      try {
        sub(event);
      } catch (err) {
        this.logger.warn(`subscriber push failed: ${String(err)}`);
      }
    }
  }
}
