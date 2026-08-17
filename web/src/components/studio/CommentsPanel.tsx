import { Button } from '../Button';
import type { LiveComment } from '../../hooks/useLiveComments';

type CommentsPanelProps = {
  isOwner: boolean;
  youtubeConnected: boolean;
  live: boolean;
  sessionActive: boolean;
  sessionTitle?: string;
  sessionPending: boolean;
  videoUrl: string;
  onVideoUrlChange: (value: string) => void;
  onStartSession: () => void;
  comments: LiveComment[];
  replyText: string;
  onReplyTextChange: (value: string) => void;
  replyPending: boolean;
  onSendReply: () => void;
  pinnedCommentId: string | null;
  onPin: (comment: LiveComment) => void;
  onClearOverlay: () => void;
};

export function CommentsPanel({
  isOwner,
  youtubeConnected,
  live,
  sessionActive,
  sessionTitle,
  sessionPending,
  videoUrl,
  onVideoUrlChange,
  onStartSession,
  comments,
  replyText,
  onReplyTextChange,
  replyPending,
  onSendReply,
  pinnedCommentId,
  onPin,
  onClearOverlay,
}: CommentsPanelProps) {
  if (!live) return null;

  if (!isOwner) {
    return (
      <section className="flex flex-col gap-2.5 min-h-0 max-h-[min(70vh,640px)] rounded-xl border border-border bg-surface-raised p-3">
        <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle">
          YouTube chat
        </h2>
        <p className="text-sm text-ink-muted">Only the room owner can manage live comments.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 min-h-0 max-h-[min(70vh,640px)] rounded-xl border border-border bg-surface-raised p-3">
      <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle">
        YouTube chat
      </h2>

      {!youtubeConnected && (
        <p className="text-sm text-ink-muted">Connect YouTube in Settings to pull live chat.</p>
      )}

      {youtubeConnected && !sessionActive && (
        <div className="flex flex-col gap-2">
          <input
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Live video URL (optional)"
            value={videoUrl}
            onChange={(e) => onVideoUrlChange(e.target.value)}
            title="Leave blank to use your active YouTube broadcast"
          />
          <Button type="button" loading={sessionPending} onClick={onStartSession}>
            Start chat feed
          </Button>
        </div>
      )}

      {sessionActive && (
        <>
          {sessionTitle && <p className="m-0 text-xs text-ink-muted">{sessionTitle}</p>}
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-[120px]">
            {comments.length === 0 && (
              <p className="text-sm text-ink-muted">Waiting for comments…</p>
            )}
            {comments.map((c) => (
              <div
                key={c.id}
                className={`flex flex-col gap-1 rounded-lg bg-surface-muted p-2 ${
                  pinnedCommentId === c.id ? 'outline outline-1 outline-accent' : ''
                }`}
              >
                <div className="flex flex-col gap-0.5 text-sm leading-snug">
                  <strong className="text-xs text-accent">{c.author}</strong>
                  <span>{c.text}</span>
                </div>
                <div>
                  <button
                    type="button"
                    className="bg-transparent p-0 text-xs font-semibold text-accent hover:underline"
                    onClick={() => onPin(c)}
                  >
                    On screen
                  </button>
                </div>
              </div>
            ))}
          </div>
          {pinnedCommentId && (
            <Button type="button" onClick={onClearOverlay}>
              Clear on-screen
            </Button>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSendReply();
            }}
          >
            <input
              className="flex-1 min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              type="text"
              placeholder="Reply on YouTube…"
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              maxLength={200}
            />
            <Button type="submit" loading={replyPending} disabled={!replyText.trim()}>
              Send
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
