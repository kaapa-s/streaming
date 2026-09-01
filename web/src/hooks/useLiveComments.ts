import { useEffect, useRef, useState } from 'react';
import type { CommentOverlay } from '@streaming/canvas-compositor';
import { apiFetch, getAccessToken } from '../lib/auth';

export type LiveComment = {
  id: string;
  platform: 'youtube';
  author: string;
  authorAvatarUrl?: string;
  text: string;
  publishedAt: string;
  canReply: boolean;
};

type YoutubeStatus = {
  connected: boolean;
  accountLabel?: string;
  externalAccountId?: string;
};

type ChatBindStatus = 'connecting' | 'active' | 'failed';

type UseLiveCommentsArgs = {
  room: string;
  live: boolean;
  isOwner: boolean;
  signedIn: boolean;
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
  isOwner,
  signedIn,
  setError,
  setPreviewOverlay,
}: UseLiveCommentsArgs) {
  const [youtubeStatus, setYoutubeStatus] = useState<YoutubeStatus>({ connected: false });
  const [youtubePending, setYoutubePending] = useState(false);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | undefined>();
  const [replyText, setReplyText] = useState('');
  const [replyPending, setReplyPending] = useState(false);
  const [sessionPending, setSessionPending] = useState(false);
  const [bindFailed, setBindFailed] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const clearPinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshYoutubeStatus = async () => {
    if (!signedIn || !getAccessToken()) return;
    try {
      const res = await apiFetch('/api/platforms/youtube/status');
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      const body = (await res.json()) as YoutubeStatus;
      setYoutubeStatus(body);
    } catch (err) {
      setError(reportCommentsError('youtube status failed', err));
    }
  };

  useEffect(() => {
    if (!signedIn) {
      setYoutubeStatus({ connected: false });
      return;
    }
    void refreshYoutubeStatus();
    // refreshYoutubeStatus closes over signedIn; re-run when auth changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const yt = params.get('youtube');
    if (!yt) return;
    if (yt === 'connected') {
      void refreshYoutubeStatus();
    } else if (yt === 'error') {
      const message = params.get('message') || 'YouTube connect failed';
      console.error('[comments] youtube oauth callback error', message);
      setError(message);
    }
    params.delete('youtube');
    params.delete('message');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    // refreshYoutubeStatus is recreated each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setError]);

  const connectYoutube = async () => {
    setYoutubePending(true);
    setError('');
    try {
      const res = await apiFetch('/api/platforms/youtube/connect');
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } catch (err) {
      setError(reportCommentsError('youtube connect failed', err));
      setYoutubePending(false);
    }
  };

  const stopStream = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const disconnectYoutube = async () => {
    setYoutubePending(true);
    setError('');
    try {
      const res = await apiFetch('/api/platforms/youtube', { method: 'DELETE' });
      if (!res.ok) throw new Error(await parseError(res));
      setYoutubeStatus({ connected: false });
      stopStream();
      setSessionActive(false);
      setSessionPending(false);
      setBindFailed(false);
      setComments([]);
    } catch (err) {
      setError(reportCommentsError('youtube disconnect failed', err));
    } finally {
      setYoutubePending(false);
    }
  };

  const clearPinned = () => {
    if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
    clearPinTimer.current = undefined;
    setPinnedId(null);
    setPreviewOverlay(null);
  };

  useEffect(() => {
    if (!live || !isOwner || !youtubeStatus.connected) {
      stopStream();
      setSessionActive(false);
      setSessionPending(false);
      setBindFailed(false);
      setComments([]);
      if (!live) clearPinned();
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setSessionPending(true);
    setBindFailed(false);
    setError('');

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
        const statusPayload = payload as { bindStatus?: ChatBindStatus; title?: string };
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
      } else if (event === 'error') {
        const errPayload = payload as { message?: string };
        console.error('[comments] youtube stream error', errPayload);
        setError(
          errPayload.message?.trim() ||
            `YouTube comments error: ${JSON.stringify(errPayload)}`,
        );
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
            const body = (await res.json()) as { status?: ChatBindStatus; title?: string };
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
    // clearPinned uses setPreviewOverlay; omitting it avoids re-subscribing mid-stream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, isOwner, youtubeStatus.connected, room, setError, setPreviewOverlay]);

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !isOwner) return;
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
      setError(reportCommentsError('youtube reply failed', err));
    } finally {
      setReplyPending(false);
    }
  };

  const pinComment = async (comment: LiveComment) => {
    if (!isOwner) return;
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
    youtubeStatus,
    youtubePending,
    connectYoutube,
    disconnectYoutube,
    comments,
    sessionActive,
    sessionTitle,
    sessionPending,
    bindFailed,
    replyText,
    setReplyText,
    replyPending,
    sendReply,
    pinComment,
    clearOverlay,
    pinnedId,
    isOwner,
  };
}
