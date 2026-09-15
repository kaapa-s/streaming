import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../../components/Button';
import { createRoom } from '../../../lib/rooms';
import { ensureAuthenticated } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

export const Route = createFileRoute('/_studio/_app/new')({
  beforeLoad: ({ context, location }) => {
    ensureAuthenticated(context.studioHandle, location.href);
  },
  component: NewStreamPage,
});

function NewStreamPage() {
  const navigate = useNavigate();
  const s = useStudio();
  const [title, setTitle] = useState(defaultTitle());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (!s.user) return null;

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name || pending) return;
    setPending(true);
    setError('');
    void (async () => {
      try {
        const room = await createRoom(name);
        await navigate({ to: '/r/$slug', params: { slug: room.slug } });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPending(false);
      }
    })();
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">New stream</h1>
      <p className="mt-2 text-sm text-ink-muted leading-relaxed">
        Creates a room with its own invite link. Share the link to bring guests in, then
        record or go live from studio.
      </p>

      <form
        onSubmit={start}
        className="mt-8 rounded-xl border border-border bg-surface-raised p-6 flex flex-col gap-5 shadow-sm"
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Stream name</span>
          <input
            className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tuesday studio"
            autoComplete="off"
            maxLength={80}
            required
            disabled={pending}
          />
        </label>

        <Button type="submit" variant="primary" loading={pending} className="self-start">
          {pending ? 'Creating…' : 'Create room'}
        </Button>

        {(error || s.error) && <p className="text-sm text-danger">{error || s.error}</p>}
      </form>
    </div>
  );
}

function defaultTitle(): string {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date());
  return `${weekday} studio`;
}
