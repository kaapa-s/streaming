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

type UseLiveCommentsArgs = {
  room: string;
  live: boolean;
  /** When false, do not auto-start the YouTube chat session on go-live. */
  pullChat: boolean;
  isOwner: boolean;
  setError: (message: string) => void;
  setPreviewOverlay: (overlay: CommentOverlay | null) => void;
};

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    return msg ?? res.statusText;
  } catch {
    return res.statusText || 'request failed';
  }
}

export function useLiveComments({
  room,
  live,
  pullChat,
  isOwner,
  setError,
  setPreviewOverlay,
}: UseLiveCommentsArgs) {
  const [youtubeStatus, setYoutubeStatus] = useState<YoutubeStatus>({ connected: false });
  const [youtubePending, setYoutubePending] = useState(false);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyPending, setReplyPending] = useState(false);
  const [sessionPending, setSessionPending] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const clearPinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshYoutubeStatus = async () => {
    const res = await apiFetch('/api/platforms/youtube/status');
    if (!res.ok) return;
    const body = (await res.json()) as YoutubeStatus;
    setYoutubeStatus(body);
  };

  useEffect(() => {
    void refreshYoutubeStatus();
  }, []);

  // Surface OAuth redirect query params once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const yt = params.get('youtube');
    if (!yt) return;
    if (yt === 'connected') {
      void refreshYoutubeStatus();
    } else if (yt === 'error') {
      setError(params.get('message') || 'YouTube connect failed');
    }
    params.delete('youtube');
    params.delete('message');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
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
      setError(err instanceof Error ? err.message : String(err));
      setYoutubePending(false);
    }
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
      setComments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setYoutubePending(false);
    }
  };

  const stopStream = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const startCommentsStream = async () => {
    stopStream();
    const token = getAccessToken();
    if (!token) return;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(room)}/comments/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
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
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setSessionActive(false);
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
      if (errPayload.message) setError(errPayload.message);
    }
  };

  const startSession = async () => {
    if (!isOwner) return;
    setSessionPending(true);
    setError('');
    try {
      const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/comments/session`, {
        method: 'POST',
        body: JSON.stringify({
          videoUrl: videoUrl.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { title?: string };
      setSessionTitle(body.title);
      setSessionActive(true);
      setComments([]);
      void startCommentsStream();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSessionActive(false);
    } finally {
      setSessionPending(false);
    }
  };

  // Auto-start chat when going live with pull-chat opted in (owner + YouTube connected).
  useEffect(() => {
    if (
      !live ||
      !pullChat ||
      !isOwner ||
      !youtubeStatus.connected ||
      sessionActive ||
      sessionPending
    ) {
      return;
    }
    void startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional trigger on live/connected/pullChat
  }, [live, pullChat, isOwner, youtubeStatus.connected]);

  useEffect(() => {
    if (!live && sessionActive) {
      stopStream();
      setSessionActive(false);
      if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
      clearPinTimer.current = undefined;
      setPinnedId(null);
      setPreviewOverlay(null);
    }
  }, [live, sessionActive, setPreviewOverlay]);

  useEffect(() => () => stopStream(), []);

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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplyPending(false);
    }
  };

  const clearPinned = () => {
    if (clearPinTimer.current) clearTimeout(clearPinTimer.current);
    clearPinTimer.current = undefined;
    setPinnedId(null);
    setPreviewOverlay(null);
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
      setError(err instanceof Error ? err.message : String(err));
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
    videoUrl,
    setVideoUrl,
    startSession,
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
