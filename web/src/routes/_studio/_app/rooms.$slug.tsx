import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { apiFetch } from '../../../lib/auth';
import { keepStudioSearch } from '../../../lib/studioSearch';
import { mediaStatusLabel } from '../../../lib/streamLabels';

export const Route = createFileRoute('/_studio/_app/rooms/$slug')({ component: FinishedStreamPage });

type RoomStatus = 'created' | 'active' | 'finished';

type RoomMeta = { id: string; slug: string; name: string; status: RoomStatus; role: string };

type MediaStatus = 'starting' | 'recording' | 'stopping' | 'uploading' | 'finished' | 'failed';

type Media = {
  status: MediaStatus;
  live: boolean;
  resolution: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  error: string | null;
  file: string | null;
  playbackUrl?: string;
  downloadUrl?: string;
} | null;

const PROCESSING_STATUSES: MediaStatus[] = ['starting', 'recording', 'stopping', 'uploading'];
const POLL_INTERVAL_MS = 5000;

function isProcessing(status: MediaStatus): boolean {
  return PROCESSING_STATUSES.includes(status);
}

function statusLabel(status: MediaStatus): string {
  return mediaStatusLabel(status);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function mediaFromPayload(payload: unknown): Media {
  if (typeof payload !== 'object' || payload === null || !('media' in payload)) return null;
  const media = payload.media;
  return typeof media === 'object' && media !== null ? media as Media : null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    return message || fallback;
  } catch {
    return fallback;
  }
}

class ForbiddenError extends Error {}

async function loadRoomMedia(slug: string): Promise<{ room: RoomMeta; media: Media }> {
  const [roomResponse, mediaResponse] = await Promise.all([
    apiFetch(`/api/rooms/${encodeURIComponent(slug)}`),
    apiFetch(`/api/rooms/${encodeURIComponent(slug)}/media`),
  ]);
  if (!roomResponse.ok) throw new Error(await readError(roomResponse, 'Unable to load this stream'));
  const room = (await roomResponse.json()) as RoomMeta;
  if (mediaResponse.status === 403) {
    throw new ForbiddenError("Playback and download are available to the stream's owner only.");
  }
  if (!mediaResponse.ok) {
    throw new Error(await readError(mediaResponse, 'Unable to load stream media'));
  }
  const text = await mediaResponse.text();
  if (!text.trim()) return { room, media: null };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Unable to read stream media');
  }
  return { room, media: mediaFromPayload(payload) };
}

function FinishedStreamPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [media, setMedia] = useState<Media>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await loadRoomMedia(slug);
      setRoom(result.room);
      setMedia(result.media);
      setError('');
      setForbidden(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load stream media');
      setForbidden(reason instanceof ForbiddenError);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // An active/created stream must never be viewed as a completed stream: hand it
  // back to the studio lobby instead of rendering a stale playback page.
  useEffect(() => {
    if (room && room.status !== 'finished') {
      void navigate({ to: '/join', search: { room: room.slug } });
    }
  }, [navigate, room]);

  const processing = media !== null && isProcessing(media.status);

  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load, processing]);

  if (room && room.status !== 'finished') {
    return <div className="max-w-3xl">
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Opening {room.name}…</h1>
      <p className="mt-2 text-sm text-ink-muted">This stream is not finished, so it opens in the studio.</p>
    </div>;
  }

  return <div className="max-w-3xl">
    <Link to="/dashboard" search={keepStudioSearch} className="text-sm font-semibold text-accent hover:text-accent-hover">← Streams</Link>
    <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{room?.name ?? 'Completed stream'}</h1>
        <p className="mt-2 text-sm text-ink-muted">/{slug} · Read-only stream</p>
      </div>
      {media && <StatusChip status={media.status} />}
    </div>

    {loading && <p className="mt-8 text-sm text-ink-muted">Loading stream media…</p>}
    {!loading && error && <div className="mt-8 rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
      <p className={`text-sm ${forbidden ? 'text-ink-muted' : 'text-danger'}`}>{error}</p>
      {!forbidden && <Button className="mt-4" type="button" onClick={() => { setLoading(true); void load(); }}>Try again</Button>}
    </div>}

    {!loading && !error && !media && <div className="mt-8 rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
      <p className="text-sm text-ink-muted">No media is available for this stream.</p>
      <Link to="/dashboard" search={keepStudioSearch} className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">Create a new stream</Link>
    </div>}

    {!loading && !error && media && <div className="mt-8 rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
      <MediaMetadata media={media} />

      {media.playbackUrl && <video className="mt-5 w-full rounded-lg bg-black" controls preload="metadata" src={media.playbackUrl}>Your browser does not support video playback.</video>}

      {media.playbackUrl && media.downloadUrl && <a className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover" href={media.downloadUrl} download>Download stream</a>}

      {!media.playbackUrl && processing && <div className="mt-5 rounded-lg border border-border bg-surface-muted p-4">
        <p className="text-sm font-medium text-ink">Processing your stream…</p>
        <p className="mt-1 text-sm text-ink-muted">The stream file is being finalized. This page refreshes automatically.</p>
        <Button className="mt-4" type="button" onClick={() => { setLoading(true); void load(); }}>Check now</Button>
      </div>}

      {!media.playbackUrl && !processing && media.status === 'failed' && <div className="mt-5 rounded-lg border border-border bg-surface-muted p-4">
        <p className="text-sm font-medium text-danger">Stream failed</p>
        <p className="mt-1 text-sm text-ink-muted">{media.error || 'The stream could not be finalized.'}</p>
        <p className="mt-1 text-sm text-ink-muted">This stream is finished and cannot be reopened. Start a new stream to go again.</p>
        <Link to="/dashboard" search={keepStudioSearch} className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">Create a new stream</Link>
      </div>}

      {!media.playbackUrl && !processing && media.status === 'finished' && <div className="mt-5 rounded-lg border border-border bg-surface-muted p-4">
        <p className="text-sm font-medium text-ink">Stream saved without cloud storage</p>
        <p className="mt-1 text-sm text-ink-muted">The stream finished, but this server cannot stream it for playback or download.</p>
        <Button className="mt-4" type="button" onClick={() => { setLoading(true); void load(); }}>Check again</Button>
      </div>}
    </div>}
  </div>;
}

function StatusChip({ status }: { status: MediaStatus }) {
  const tone = status === 'finished'
    ? 'text-success'
    : status === 'failed'
      ? 'text-danger'
      : 'text-accent';
  return <span className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold ${tone}`}>
    <span className="inline-block size-1.5 rounded-full bg-current" />
    {statusLabel(status)}
  </span>;
}

function MediaMetadata({ media }: { media: NonNullable<Media> }) {
  const items: Array<[string, string]> = [
    ['Duration', formatDuration(media.durationSeconds)],
    ['Started', formatDateTime(media.startedAt)],
    ['Finished', formatDateTime(media.endedAt)],
    ['Quality', media.resolution],
    ['Mode', media.live ? 'Live stream' : 'Private stream'],
  ];
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
    {items.map(([label, value]) => <div key={label}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>)}
  </dl>;
}
