import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/jwt.strategy';
import { YoutubeOAuthService } from '../platforms/youtube-oauth.service';
import { CompositorClient } from '../recordings/compositor.client';
import { RoomsService } from '../rooms/rooms.service';
import type { CommentOverlayPayload, NormalizedComment } from './types';
import { YoutubeLiveChatAdapter } from './youtube-live-chat.adapter';

const OVERLAY_TTL_MS = 10_000;
const MAX_BUFFERED_COMMENTS = 200;

interface RoomChatSession {
  roomSlug: string;
  ownerUserId: string;
  chatId: string;
  title?: string;
  videoId?: string;
  pageToken?: string;
  subscribers: Set<(event: MessageEvent) => void>;
  comments: NormalizedComment[];
  seenIds: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  polling: boolean;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);
  private readonly sessions = new Map<string, RoomChatSession>();

  constructor(
    private readonly rooms: RoomsService,
    private readonly youtubeOAuth: YoutubeOAuthService,
    private readonly youtubeChat: YoutubeLiveChatAdapter,
    private readonly compositor: CompositorClient,
  ) {}

  private async requireOwner(slug: string, user: AuthUser) {
    const { room, member } = await this.rooms.requireMembershipBySlug(slug, user.id);
    if (member.role !== 'owner') {
      throw new ForbiddenException('only the room owner can manage live comments');
    }
    return room;
  }

  async startSession(
    slug: string,
    user: AuthUser,
    videoUrl?: string,
  ): Promise<{ chatId: string; title?: string; videoId?: string }> {
    const room = await this.requireOwner(slug, user);
    const accessToken = await this.youtubeOAuth.getValidAccessToken(user.id);
    const resolved = await this.youtubeChat.resolveChatSession({
      accessToken,
      videoUrl,
    });

    const key = room.slug;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.chatId = resolved.chatId;
      existing.title = resolved.title;
      existing.videoId = resolved.videoId;
      existing.ownerUserId = user.id;
      existing.pageToken = undefined;
      existing.comments = [];
      existing.seenIds.clear();
      this.schedulePoll(existing, 0);
      return {
        chatId: existing.chatId,
        title: existing.title,
        videoId: existing.videoId,
      };
    }

    const session: RoomChatSession = {
      roomSlug: key,
      ownerUserId: user.id,
      chatId: resolved.chatId,
      title: resolved.title,
      videoId: resolved.videoId,
      subscribers: new Set(),
      comments: [],
      seenIds: new Set(),
      polling: false,
    };
    this.sessions.set(key, session);
    this.schedulePoll(session, 0);
    return {
      chatId: session.chatId,
      title: session.title,
      videoId: session.videoId,
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
      const room = await this.requireOwner(slug, user);
      const session = this.sessions.get(room.slug);
      if (!session) {
        fail(
          new BadRequestException(
            'No comments session — start one after connecting YouTube and going live',
          ),
        );
        return () => undefined;
      }

      const handler = (event: MessageEvent) => push(event);
      session.subscribers.add(handler);

      // Snapshot for late joiners.
      push({
        type: 'snapshot',
        data: JSON.stringify({ comments: session.comments }),
      } as MessageEvent);

      return () => {
        session.subscribers.delete(handler);
        if (session.subscribers.size === 0) {
          this.stopSession(room.slug);
        }
      };
    } catch (err) {
      fail(err);
      return () => undefined;
    }
  }

  async reply(slug: string, user: AuthUser, text: string): Promise<NormalizedComment> {
    const room = await this.requireOwner(slug, user);
    const session = this.sessions.get(room.slug);
    if (!session) {
      throw new BadRequestException('No active comments session');
    }
    const accessToken = await this.youtubeOAuth.getValidAccessToken(user.id);
    const comment = await this.youtubeChat.postReply(accessToken, session.chatId, text);
    this.ingestComments(session, [comment]);
    return comment;
  }

  async setOverlay(
    slug: string,
    user: AuthUser,
    comment: { author: string; text: string } | null,
  ): Promise<{ ok: true; overlay: CommentOverlayPayload | null }> {
    await this.requireOwner(slug, user);
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
      // Preview can still show locally; air may be warm-only.
      this.logger.warn(`compositor overlay failed for ${slug}: ${String(err)}`);
      if (overlay) throw err;
    }
    return { ok: true, overlay };
  }

  stopSession(slug: string): void {
    const key = slug.trim().toLowerCase();
    const session = this.sessions.get(key);
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    this.sessions.delete(key);
  }

  private schedulePoll(session: RoomChatSession, delayMs: number): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      void this.pollOnce(session);
    }, Math.max(0, delayMs));
  }

  private async pollOnce(session: RoomChatSession): Promise<void> {
    if (!this.sessions.has(session.roomSlug)) return;
    if (session.polling) {
      this.schedulePoll(session, 1000);
      return;
    }
    session.polling = true;
    let nextDelay = 5000;
    try {
      const accessToken = await this.youtubeOAuth.getValidAccessToken(session.ownerUserId);
      const result = await this.youtubeChat.pollComments(
        accessToken,
        session.chatId,
        session.pageToken,
      );
      session.pageToken = result.nextPageToken ?? session.pageToken;
      nextDelay = result.pollingIntervalMs;
      this.ingestComments(session, result.comments);
    } catch (err) {
      this.logger.warn(`poll failed room=${session.roomSlug}: ${String(err)}`);
      this.broadcast(session, {
        type: 'error',
        data: JSON.stringify({
          message: err instanceof Error ? err.message : String(err),
        }),
      });
      nextDelay = 10_000;
    } finally {
      session.polling = false;
      if (this.sessions.has(session.roomSlug) && session.subscribers.size > 0) {
        this.schedulePoll(session, nextDelay);
      } else if (session.subscribers.size === 0) {
        this.stopSession(session.roomSlug);
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
