import { useEffect, useRef, useState } from 'react';
import type { CommentOverlay } from '@streaming/canvas-compositor';
import { apiFetch } from '../lib/auth';

export type LiveComment = {
  id: string;
  platform: string;
  author: string;
  authorId?: string;
  authorAvatarUrl?: string;
  text: string;
  publishedAt: string;
  canReply: boolean;
};

export type CommentCapabilities = {
  reply: boolean;
  remove: boolean;
  ban: boolean;
  pin: boolean;
};

const NO_CAPABILITIES: CommentCapabilities = {
  reply: false,
  remove: false,
  ban: false,
  pin: false,
};

type ChatBindStatus = 'connecting' | 'active' | 'failed';

type UseLiveCommentsArgs = {
  room: string;
  /** True while the room is live to a comments-capable destination. */
  live: boolean;
  /** True for an authenticated room participant; guests never subscribe. */
  enabled: boolean;
  setError: (message: string) => void;
  setPreviewOverlay: (overlay: CommentOverlay | null) => void;
};

async function parseError(res: Response): Promise<string> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    const fallback = `${res.status} ${res.statusText || 'request failed'}`.trim();
    console.error('[comments] non-JSON error response', res.status, res.statusText);
    return fallback;
  }
  const record = typeof body === 'object' && body !== null ? body : {};
  const raw =
    'message' in record
      ? Array.isArray(record.message)
        ? record.message.join(', ')
        : record.message
      : undefined;
  const msg = typeof raw === 'string' && raw.trim() ? raw : `${res.status} ${res.statusText}`.trim();
  console.error('[comments] API error', res.status, body);
  return msg;
}

function reportCommentsError(context: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[comments] ${context}`, err);
  return message;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function useLiveComments({
  room,
  live,
  enabled,
  setError,
  setPreviewOverlay,
}: UseLiveCommentsArgs) {
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | undefined>();
  const [provider, setProvider] = useState('');
  const [capabilities, setCapabilities] = useState<CommentCapabilities>(NO_CAPABILITIES);
  const [replyText, setReplyText] = useState('');
  const [replyPending, setReplyPending] = useState(false);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [sessionPending, setSessionPending] = useState(false);
  const [bindFailed, setBindFailed] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const clearPinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stopStream = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const clearPinned = () => {
    if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
    clearPinTimer.current = undefined;
    setPinnedId(null);
    setPreviewOverlay(null);
  };

  useEffect(() => {
    if (!live || !enabled) {
      stopStream();
      setSessionActive(false);
      setSessionPending(false);
      setBindFailed(false);
      setCapabilities(NO_CAPABILITIES);
      setProvider('');
      setComments((prev) => (prev.length === 0 ? prev : []));
      if (!live) clearPinned();
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setSessionPending(true);
    setBindFailed(false);
    setError('');

    const applyCapabilities = (payload: {
      provider?: string;
      capabilities?: Partial<CommentCapabilities>;
    }) => {
      if (payload.provider) setProvider(payload.provider);
      if (payload.capabilities) {
        setCapabilities({ ...NO_CAPABILITIES, ...payload.capabilities });
      }
    };

    const applyBindStatus = (status: ChatBindStatus, title?: string) => {
      if (title) setSessionTitle(title);
      if (status === 'active') {
        setSessionActive(true);
        setSessionPending(false);
        setBindFailed(false);
      } else if (status === 'failed') {
        setSessionActive(false);
        setSessionPending(false);
        setBindFailed(true);
      } else {
        setSessionActive(false);
        setSessionPending(true);
        setBindFailed(false);
      }
    };

    const handleSseChunk = (chunk: string) => {
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;
      let payload: unknown;
      try {
        payload = JSON.parse(dataLines.join('\n'));
      } catch {
        return;
      }
      if (event === 'status') {
        const statusPayload = payload as {
          bindStatus?: ChatBindStatus;
          title?: string;
          provider?: string;
          capabilities?: Partial<CommentCapabilities>;
        };
        applyCapabilities(statusPayload);
        if (statusPayload.bindStatus) {
          applyBindStatus(statusPayload.bindStatus, statusPayload.title);
        }
        return;
      }
      if (event === 'snapshot' || event === 'comments') {
        const commentsPayload = payload as { comments?: LiveComment[] };
        const list = commentsPayload.comments ?? [];
        if (event === 'snapshot') {
          setComments(list);
        } else if (list.length > 0) {
          setComments((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            const next = [...prev];
            for (const c of list) {
              if (!seen.has(c.id)) next.push(c);
            }
            return next.slice(-200);
          });
        }
      } else if (event === 'removed') {
        const removed = payload as { id?: string };
        if (removed.id) {
          setComments((prev) => prev.filter((c) => c.id !== removed.id));
          setPinnedId((prev) => (prev === removed.id ? null : prev));
        }
      } else if (event === 'banned') {
        const banned = payload as { authorId?: string };
        if (banned.authorId) {
          setComments((prev) => prev.filter((c) => c.authorId !== banned.authorId));
        }
      } else if (event === 'error') {
        const errPayload = payload as { message?: string };
        console.error('[comments] stream error', errPayload);
        setError(errPayload.message?.trim() || `Comments error: ${JSON.stringify(errPayload)}`);
      }
    };

    const openStream = async () => {
      const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/comments/stream`, {
        headers: { Accept: 'text/event-stream' },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(await parseError(res));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          handleSseChunk(chunk);
        }
      }
    };

    const run = async () => {
      while (!ac.signal.aborted) {
        try {
          const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/comments/session`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          if (ac.signal.aborted) return;
          if (!res.ok) {
            setError(await parseError(res));
          } else {
            const body = (await res.json()) as {
              status?: ChatBindStatus;
              title?: string;
              provider?: string;
              capabilities?: Partial<CommentCapabilities>;
            };
            applyCapabilities(body);
            if (body.status) applyBindStatus(body.status, body.title);
          }
          await openStream();
        } catch (err) {
          if (ac.signal.aborted) return;
          setSessionActive(false);
          setError(reportCommentsError('comments stream failed', err));
        }
        if (ac.signal.aborted) return;
        await sleep(2000, ac.signal);
      }
    };

    void run();

    return () => {
      ac.abort();
      if (abortRef.current === ac) abortRef.current = null;
    };
    // Overlay setter is not an input to this subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, enabled, room, setError]);

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !capabilities.reply) return;
    setReplyPending(true);
    setError('');
    try {
      const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/comments/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      setReplyText('');
    } catch (err) {
      setError(reportCommentsError('comment reply failed', err));
    } finally {
      setReplyPending(false);
    }
  };

  const pinComment = async (comment: LiveComment) => {
    if (!capabilities.pin) return;
    setError('');
    const until = Date.now() + 10_000;
    setPreviewOverlay({ author: comment.author, text: comment.text, until });
    setPinnedId(comment.id);
    if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
    clearPinTimer.current = setTimeout(() => {
      setPinnedId(null);
      setPreviewOverlay(null);
    }, 10_000);
    try {
      const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/overlay`, {
        method: 'POST',
        body: JSON.stringify({ comment: { author: comment.author, text: comment.text } }),
      });
      if (!res.ok) throw new Error(await parseError(res));
    } catch (err) {
      setError(reportCommentsError('pin comment failed', err));
    }
  };

  const removeComment = async (comment: LiveComment) => {
    if (!capabilities.remove) return;
    setActionPendingId(comment.id);
    setError('');
    try {
      const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/comments/remove`, {
        method: 'POST',
        body: JSON.stringify({ commentId: comment.id }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
    } catch (err) {
      setError(reportCommentsError('remove comment failed', err));
    } finally {
      setActionPendingId(null);
    }
  };

  const banCommentAuthor = async (comment: LiveComment, durationSeconds?: number) => {
    if (!capabilities.ban || !comment.authorId) return;
    setActionPendingId(comment.id);
    setError('');
    try {
      const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/comments/ban`, {
        method: 'POST',
        body: JSON.stringify({ authorId: comment.authorId, durationSeconds }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      setComments((prev) => prev.filter((c) => c.authorId !== comment.authorId));
    } catch (err) {
      setError(reportCommentsError('ban comment author failed', err));
    } finally {
      setActionPendingId(null);
    }
  };

  const clearOverlay = async () => {
    clearPinned();
    try {
      await apiFetch(`/api/rooms/${encodeURIComponent(room)}/overlay`, {
        method: 'POST',
        body: JSON.stringify({ comment: null }),
      });
    } catch {
      /* best-effort */
    }
  };

  return {
    comments,
    sessionActive,
    sessionTitle,
    sessionPending,
    bindFailed,
    provider,
    capabilities,
    replyText,
    setReplyText,
    replyPending,
    sendReply,
    pinComment,
    removeComment,
    banCommentAuthor,
    actionPendingId,
    clearOverlay,
    pinnedId,
  };
}
