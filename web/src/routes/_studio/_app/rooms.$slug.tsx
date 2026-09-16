import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/auth';
import { keepStudioSearch } from '../../../lib/studioSearch';

export const Route = createFileRoute('/_studio/_app/rooms/$slug')({ component: FinishedRoomPage });

type Media = { status: string; startedAt: string | null; endedAt: string | null; file: string | null; downloadUrl?: string } | null;

function FinishedRoomPage() {
  const { slug } = Route.useParams();
  const [media, setMedia] = useState<Media>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    void apiFetch(`/api/rooms/${encodeURIComponent(slug)}/media`).then(async (response) => {
      if (!response.ok) throw new Error('Unable to load room media');
      setMedia(await response.json() as Media);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load room media')).finally(() => setLoading(false));
  }, [slug]);

  return <div className="max-w-3xl">
    <Link to="/dashboard" search={keepStudioSearch} className="text-sm font-semibold text-accent hover:text-accent-hover">← Rooms</Link>
    <h1 className="mt-5 text-2xl font-semibold tracking-tight">Finished room</h1>
    <p className="mt-2 text-sm text-ink-muted">/{slug} · Read-only history</p>
    {loading && <p className="mt-8 text-sm text-ink-muted">Loading recorded media…</p>}
    {error && <p className="mt-8 text-sm text-danger">{error}</p>}
    {!loading && !error && <div className="mt-8 rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
      {!media && <p className="text-sm text-ink-muted">No recorded media is available for this room.</p>}
      {media && <>
        <p className="font-medium">Recorded output: {media.status}</p>
        {media.downloadUrl && <video className="mt-5 w-full rounded-lg bg-black" controls src={media.downloadUrl}>Your browser does not support video playback.</video>}
        {media.downloadUrl ? <a className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover" href={media.downloadUrl} download>Download recording</a> : <p className="mt-3 text-sm text-ink-muted">Media is still processing or is only available on the recording host.</p>}
      </>}
    </div>}
  </div>;
}
