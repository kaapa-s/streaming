import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  LiveChatAdapter,
  NormalizedComment,
  PollCommentsResult,
  ResolveChatInput,
  ResolvedChatSession,
} from './types';
import { LiveChatEndedError } from './types';

interface LiveBroadcastItem {
  id?: string;
  snippet?: { title?: string; liveChatId?: string };
  status?: { lifeCycleStatus?: string };
}

interface LiveBroadcastList {
  items?: LiveBroadcastItem[];
}

interface LiveChatMessageList {
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  items?: Array<{
    id?: string;
    snippet?: {
      type?: string;
      publishedAt?: string;
      displayMessage?: string;
      textMessageDetails?: { messageText?: string };
    };
    authorDetails?: {
      displayName?: string;
      profileImageUrl?: string;
      isChatOwner?: boolean;
      isChatModerator?: boolean;
    };
  }>;
}

interface LiveChatInsertResponse {
  id?: string;
  snippet?: {
    publishedAt?: string;
    displayMessage?: string;
    textMessageDetails?: { messageText?: string };
  };
  authorDetails?: {
    displayName?: string;
    profileImageUrl?: string;
  };
}

const YT_API = 'https://www.googleapis.com/youtube/v3';
/** REST path for liveChatMessages.list / insert — not the camelCase resource name. */
const LIVE_CHAT_MESSAGES_PATH = 'liveChat/messages';
const UPCOMING_CHAT_STATUSES = new Set(['live', 'testing']);

function parseYoutubeErrorBody(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as {
      error?: {
        code?: number;
        status?: string;
        message?: string;
        errors?: Array<{ reason?: string; message?: string; domain?: string }>;
      };
    };
    const err = json.error;
    const reason = err?.errors?.[0]?.reason;
    const domain = err?.errors?.[0]?.domain;
    const top = err?.message?.trim();
    const nested = err?.errors?.[0]?.message?.trim();
    const parts = [
      err?.status,
      err?.code !== undefined ? String(err.code) : undefined,
      domain,
      reason,
      top && top !== '{0}' ? top : undefined,
      nested && nested !== '{0}' && nested !== top ? nested : undefined,
    ].filter((part, index, all) => Boolean(part) && all.indexOf(part) === index);
    return parts.length > 0 ? parts.join(': ') : undefined;
  } catch {
    return undefined;
  }
}

function youtubeHttpError(kind: string, res: Response, body: string, url: string): Error {
  if (body.includes('liveChatEnded')) return new LiveChatEndedError();
  const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  const detail =
    parseYoutubeErrorBody(body) || body.slice(0, 500).trim() || 'empty body';
  return new BadRequestException(`${kind} failed (${status}) ${url}: ${detail}`);
}

export function pickLiveBroadcast(
  activeItems: LiveBroadcastItem[] | undefined,
  upcomingItems: LiveBroadcastItem[] | undefined,
): ResolvedChatSession | undefined {
  const fromActive = (activeItems ?? []).find((b) => b.snippet?.liveChatId);
  if (fromActive?.snippet?.liveChatId) {
    return {
      chatId: fromActive.snippet.liveChatId,
      videoId: fromActive.id,
      title: fromActive.snippet.title,
    };
  }

  const fromUpcoming = (upcomingItems ?? []).find((b) => {
    const life = b.status?.lifeCycleStatus;
    return Boolean(b.snippet?.liveChatId && life && UPCOMING_CHAT_STATUSES.has(life));
  });
  if (fromUpcoming?.snippet?.liveChatId) {
    return {
      chatId: fromUpcoming.snippet.liveChatId,
      videoId: fromUpcoming.id,
      title: fromUpcoming.snippet.title,
    };
  }
  return undefined;
}

@Injectable()
export class YoutubeLiveChatAdapter implements LiveChatAdapter {
  private readonly logger = new Logger(YoutubeLiveChatAdapter.name);

  async resolveChatSession(input: ResolveChatInput): Promise<ResolvedChatSession> {
    const [active, upcoming] = await Promise.all([
      this.listBroadcasts(input.accessToken, 'active'),
      this.listBroadcasts(input.accessToken, 'upcoming'),
    ]);
    const resolved = pickLiveBroadcast(active.items, upcoming.items);
    if (!resolved) {
      throw new BadRequestException(
        'No active YouTube broadcast yet — waiting for YouTube to go live',
      );
    }
    return resolved;
  }

  async pollComments(
    accessToken: string,
    chatId: string,
    pageToken?: string,
  ): Promise<PollCommentsResult> {
    const params = new URLSearchParams({
      part: 'snippet,authorDetails',
      liveChatId: chatId,
      maxResults: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await this.ytGet<LiveChatMessageList>(
      accessToken,
      `${LIVE_CHAT_MESSAGES_PATH}?${params.toString()}`,
    );

    const comments: NormalizedComment[] = [];
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      const type = item.snippet?.type;
      if (type && type !== 'textMessageEvent') continue;
      const text =
        item.snippet?.textMessageDetails?.messageText ??
        item.snippet?.displayMessage ??
        '';
      if (!text) continue;
      comments.push({
        id: item.id,
        platform: 'youtube',
        author: item.authorDetails?.displayName ?? 'Unknown',
        authorAvatarUrl: item.authorDetails?.profileImageUrl,
        text,
        publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
        canReply: true,
      });
    }

    return {
      comments,
      nextPageToken: data.nextPageToken,
      pollingIntervalMs: data.pollingIntervalMillis ?? 5000,
    };
  }

  async postReply(
    accessToken: string,
    chatId: string,
    text: string,
  ): Promise<NormalizedComment> {
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('reply text is required');

    const url = `${YT_API}/${LIVE_CHAT_MESSAGES_PATH}?part=snippet`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          liveChatId: chatId,
          type: 'textMessageEvent',
          textMessageDetails: { messageText: trimmed },
        },
      }),
    });
    if (!res.ok) {
      const errText = await this.readErrorBody(res);
      this.logger.warn(
        `YouTube POST ${url} -> ${res.status} ${res.statusText} body=${errText}`,
      );
      throw youtubeHttpError('liveChatMessages.insert', res, errText, url);
    }
    const data = (await res.json()) as LiveChatInsertResponse;
    return {
      id: data.id ?? `local-${Date.now()}`,
      platform: 'youtube',
      author: data.authorDetails?.displayName ?? 'You',
      authorAvatarUrl: data.authorDetails?.profileImageUrl,
      text:
        data.snippet?.textMessageDetails?.messageText ??
        data.snippet?.displayMessage ??
        trimmed,
      publishedAt: data.snippet?.publishedAt ?? new Date().toISOString(),
      canReply: true,
    };
  }

  private async listBroadcasts(
    accessToken: string,
    broadcastStatus: 'active' | 'upcoming',
  ): Promise<LiveBroadcastList> {
    const params = new URLSearchParams({
      part: 'snippet,status',
      broadcastStatus,
      broadcastType: 'all',
      maxResults: '50',
    });
    return this.ytGet<LiveBroadcastList>(accessToken, `liveBroadcasts?${params.toString()}`);
  }

  private async ytGet<T>(accessToken: string, pathAndQuery: string): Promise<T> {
    const url = `${YT_API}/${pathAndQuery}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await this.readErrorBody(res);
      this.logger.warn(`YouTube GET ${url} -> ${res.status} ${res.statusText} body=${text}`);
      throw youtubeHttpError('YouTube API', res, text, url);
    }
    return (await res.json()) as T;
  }

  private async readErrorBody(res: Response): Promise<string> {
    const text = await res.text().catch(() => '');
    return text.slice(0, 2000);
  }
}
