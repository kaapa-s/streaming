import { BadRequestException, Injectable } from '@nestjs/common';
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

const UPCOMING_CHAT_STATUSES = new Set(['live', 'testing']);

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
      maxResults: '50',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await this.ytGet<LiveChatMessageList>(
      accessToken,
      `liveChatMessages?${params.toString()}`,
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

    const res = await fetch('https://www.googleapis.com/youtube/v3/liveChatMessages?part=snippet', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
      const errText = await res.text().catch(() => '');
      throw new BadRequestException(`liveChatMessages.insert failed: ${errText.slice(0, 300)}`);
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
      maxResults: '5',
    });
    return this.ytGet<LiveBroadcastList>(accessToken, `liveBroadcasts?${params.toString()}`);
  }

  private async ytGet<T>(accessToken: string, pathAndQuery: string): Promise<T> {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (text.includes('liveChatEnded')) {
        throw new LiveChatEndedError();
      }
      throw new BadRequestException(`YouTube API error: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}
