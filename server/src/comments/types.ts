/**
 * Comments providers are intentionally open-ended: a new provider only has to
 * implement {@link LiveChatAdapter}. Room membership and authorization live in
 * CommentsService and never depend on which provider is bound.
 */
export type PlatformId = 'youtube';

export type ChatBindStatus = 'connecting' | 'active' | 'failed';

/** Provider-advertised moderation/presentation support, used for capability-aware UI. */
export interface CommentCapabilities {
  /** Provider accepts room replies posted into its live chat. */
  reply: boolean;
  /** Provider can remove (delete/hide) a single comment. */
  remove: boolean;
  /** Provider can ban or time out a comment author. */
  ban: boolean;
  /** Provider's comments can be placed on the stream via the room overlay. */
  pin: boolean;
}

export interface NormalizedComment {
  id: string;
  platform: PlatformId;
  author: string;
  /** Provider author/channel id, required for ban and timeout actions. */
  authorId?: string;
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
  readonly provider: PlatformId;
  /** Capabilities are provider-scoped; room authorization is never provider-scoped. */
  capabilities(): CommentCapabilities;
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
  /** Delete/hide one comment. Present only when `capabilities().remove` is true. */
  removeComment?(accessToken: string, chatId: string, commentId: string): Promise<void>;
  /**
   * Ban (or time out) a comment author. Present only when `capabilities().ban`
   * is true. Omit `durationSeconds` for a permanent ban.
   */
  banAuthor?(
    accessToken: string,
    chatId: string,
    authorId: string,
    durationSeconds?: number,
  ): Promise<void>;
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
