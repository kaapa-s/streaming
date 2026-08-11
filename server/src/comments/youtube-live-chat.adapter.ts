import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  LiveChatAdapter,
  NormalizedComment,
  PollCommentsResult,
  ResolveChatInput,
  ResolvedChatSession,
} from './types';

interface LiveBroadcastList {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; liveChatId?: string };
  }>;
}

interface VideoList {
  items?: Array<{
    id?: string;
    snippet?: { title?: string };
    liveStreamingDetails?: { activeLiveChatId?: string };
  }>;
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

/** Extract a YouTube video id from common URL shapes or a bare id. */
export function parseYoutubeVideoId(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      if (
        (parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'v') &&
        parts[1] &&
        /^[a-zA-Z0-9_-]{11}$/.test(parts[1])
      ) {
        return parts[1];
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

@Injectable()
export class YoutubeLiveChatAdapter implements LiveChatAdapter {
  async resolveChatSession(input: ResolveChatInput): Promise<ResolvedChatSession> {
    if (input.videoUrl?.trim()) {
      const videoId = parseYoutubeVideoId(input.videoUrl);
      if (!videoId) {
        throw new BadRequestException('Could not parse a YouTube video id from the URL');
      }
      return this.resolveFromVideoId(input.accessToken, videoId);
    }
    return this.resolveActiveBroadcast(input.accessToken);
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

  private async resolveFromVideoId(
    accessToken: string,
    videoId: string,
  ): Promise<ResolvedChatSession> {
    const params = new URLSearchParams({
      part: 'snippet,liveStreamingDetails',
      id: videoId,
    });
    const data = await this.ytGet<VideoList>(accessToken, `videos?${params.toString()}`);
    const item = data.items?.[0];
    const chatId = item?.liveStreamingDetails?.activeLiveChatId;
    if (!chatId) {
      throw new BadRequestException(
        'No active live chat for that video — is the broadcast live?',
      );
    }
    return {
      chatId,
      videoId,
      title: item?.snippet?.title,
    };
  }

  private async resolveActiveBroadcast(accessToken: string): Promise<ResolvedChatSession> {
    const params = new URLSearchParams({
      part: 'snippet',
      broadcastStatus: 'active',
      broadcastType: 'all',
      maxResults: '5',
    });
    const data = await this.ytGet<LiveBroadcastList>(
      accessToken,
      `liveBroadcasts?${params.toString()}`,
    );
    const item = data.items?.find((b) => b.snippet?.liveChatId);
    if (!item?.snippet?.liveChatId) {
      throw new BadRequestException(
        'No active YouTube broadcast (start the stream in YouTube Studio, or paste the live URL)',
      );
    }
    return {
      chatId: item.snippet.liveChatId,
      videoId: item.id,
      title: item.snippet.title,
    };
  }

  private async ytGet<T>(accessToken: string, pathAndQuery: string): Promise<T> {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(`YouTube API error: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}
