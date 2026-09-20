import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../../components/Button';
import { createRoom } from '../../../lib/auth';

export const Route = createFileRoute('/_studio/_app/dashboard')({ component: DashboardPage });

function DashboardPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const room = await createRoom(name.trim());
      void navigate({ to: '/join', search: { room: room.slug } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Create a stream</h1>
      <p className="mt-2 text-sm text-ink-muted">Your new stream opens immediately. Streaming stays stopped until you start it.</p>
      <form onSubmit={submit} className="mt-7 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5 shadow-sm sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-2">
          <span className="text-sm font-medium">Stream name</span>
          <input className="rounded-lg border border-border bg-surface px-3.5 py-2.5 outline-none focus:border-accent disabled:opacity-50" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product launch" required disabled={creating} />
        </label>
        <Button type="submit" variant="primary" loading={creating}>{creating ? 'Creating…' : 'Create stream'}</Button>
      </form>
      {error && <p className="mt-3 text-sm text-danger">{errorWithRoomLink(error)}</p>}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
function errorWithRoomLink(message: string) {
  const match = message.match(/current room:?\s*([a-zA-Z0-9_-]+)/);
  if (!match) return message;
  return <>{message} <Link to="/join" search={{ room: match[1] }} className="font-semibold underline">Open existing stream</Link></>;
}
