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
  if (!isOwner) {
    return (
      <section className="comments-panel">
        <h2>YouTube comments</h2>
        <p className="hint">Only the room owner can manage live comments.</p>
      </section>
    );
  }

  return (
    <section className="comments-panel">
      <h2>YouTube comments</h2>
      {!youtubeConnected && (
        <p className="hint">Connect YouTube in the header to pull live chat.</p>
      )}
      {youtubeConnected && !live && (
        <p className="hint">Go live to start the YouTube comment feed.</p>
      )}
      {youtubeConnected && live && !sessionActive && (
        <div className="comments-session">
          <input
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
          {sessionTitle && <p className="hint comments-title">{sessionTitle}</p>}
          <div className="comments-list">
            {comments.length === 0 && <p className="hint">Waiting for comments…</p>}
            {comments.map((c) => (
              <div
                key={c.id}
                className={`comment-row${pinnedCommentId === c.id ? ' pinned' : ''}`}
              >
                <div className="comment-body">
                  <strong>{c.author}</strong>
                  <span>{c.text}</span>
                </div>
                <div className="comment-actions">
                  <button type="button" className="linkish" onClick={() => onPin(c)}>
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
            className="comments-reply"
            onSubmit={(e) => {
              e.preventDefault();
              onSendReply();
            }}
          >
            <input
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
