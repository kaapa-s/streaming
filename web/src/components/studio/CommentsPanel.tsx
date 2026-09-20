import { Button } from '../Button';
import type { CommentCapabilities, LiveComment } from '../../hooks/useLiveComments';

type CommentsPanelProps = {
  provider: string;
  capabilities: CommentCapabilities;
  live: boolean;
  sessionActive: boolean;
  sessionTitle?: string;
  bindFailed: boolean;
  comments: LiveComment[];
  replyText: string;
  onReplyTextChange: (value: string) => void;
  replyPending: boolean;
  onSendReply: () => void;
  pinnedCommentId: string | null;
  onPin: (comment: LiveComment) => void;
  onClearOverlay: () => void;
  actionPendingId: string | null;
  onRemove: (comment: LiveComment) => void;
  onBan: (comment: LiveComment, durationSeconds?: number) => void;
};

function actionTitle(supported: boolean, provider: string, action: string): string | undefined {
  return supported ? undefined : `${provider || 'This'} comments do not support ${action}`;
}

export function CommentsPanel({
  provider,
  capabilities,
  live,
  sessionActive,
  sessionTitle,
  bindFailed,
  comments,
  replyText,
  onReplyTextChange,
  replyPending,
  onSendReply,
  pinnedCommentId,
  onPin,
  onClearOverlay,
  actionPendingId,
  onRemove,
  onBan,
}: CommentsPanelProps) {
  if (!live) return null;

  const providerLabel = provider
    ? provider.charAt(0).toUpperCase() + provider.slice(1)
    : 'Live';
  const busyId = actionPendingId;

  return (
    <section className="flex flex-col gap-2.5 min-h-0 max-h-[min(70vh,640px)] rounded-xl border border-border bg-surface-raised p-3">
      <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle">
        {providerLabel} chat
      </h2>

      {!sessionActive && (
        <p className="text-sm text-ink-muted">
          {bindFailed
            ? 'Could not connect to live chat yet. Waiting for the stream to go live…'
            : 'Connecting to live chat…'}
        </p>
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
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="bg-transparent p-0 text-xs font-semibold text-accent hover:underline disabled:cursor-default disabled:text-ink-subtle disabled:no-underline"
                    disabled={!capabilities.pin}
                    title={actionTitle(capabilities.pin, providerLabel, 'on-screen comments')}
                    onClick={() => onPin(c)}
                  >
                    On screen
                  </button>
                  <button
                    type="button"
                    className="bg-transparent p-0 text-xs font-semibold text-danger hover:underline disabled:cursor-default disabled:text-ink-subtle disabled:no-underline"
                    disabled={!capabilities.remove || busyId === c.id}
                    title={actionTitle(capabilities.remove, providerLabel, 'deleting comments')}
                    onClick={() => onRemove(c)}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="bg-transparent p-0 text-xs font-semibold text-danger hover:underline disabled:cursor-default disabled:text-ink-subtle disabled:no-underline"
                    disabled={!capabilities.ban || !c.authorId || busyId === c.id}
                    title={actionTitle(capabilities.ban, providerLabel, 'banning authors')}
                    onClick={() => onBan(c, 300)}
                  >
                    Timeout 5m
                  </button>
                  <button
                    type="button"
                    className="bg-transparent p-0 text-xs font-semibold text-danger hover:underline disabled:cursor-default disabled:text-ink-subtle disabled:no-underline"
                    disabled={!capabilities.ban || !c.authorId || busyId === c.id}
                    title={actionTitle(capabilities.ban, providerLabel, 'banning authors')}
                    onClick={() => onBan(c)}
                  >
                    Ban
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
              placeholder={`Reply on ${providerLabel}…`}
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              maxLength={200}
              disabled={!capabilities.reply}
            />
            <Button
              type="submit"
              loading={replyPending}
              disabled={!capabilities.reply || !replyText.trim()}
            >
              Send
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
