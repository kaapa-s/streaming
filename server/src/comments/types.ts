export type PlatformId = 'youtube';

export type ChatBindStatus = 'connecting' | 'active' | 'failed';

export interface NormalizedComment {
  id: string;
  platform: PlatformId;
  author: string;
  authorAvatarUrl?: string;
  text: string;
  publishedAt: string;
  canReply: boolean;
}

export interface ResolveChatInput {
  accessToken: string;
}

export interface ResolvedChatSession {
  chatId: string;
  title?: string;
  videoId?: string;
}

export interface PollCommentsResult {
  comments: NormalizedComment[];
  nextPageToken?: string;
  pollingIntervalMs: number;
}

export interface LiveChatAdapter {
  resolveChatSession(input: ResolveChatInput): Promise<ResolvedChatSession>;
  pollComments(
    accessToken: string,
    chatId: string,
    pageToken?: string,
  ): Promise<PollCommentsResult>;
  postReply(
    accessToken: string,
    chatId: string,
    text: string,
  ): Promise<NormalizedComment>;
}

export interface CommentOverlayPayload {
  author: string;
  text: string;
  /** Epoch ms when the overlay should auto-clear. */
  until: number;
}

export class LiveChatEndedError extends Error {
  constructor() {
    super('YouTube live chat has ended');
    this.name = 'LiveChatEndedError';
  }
}
