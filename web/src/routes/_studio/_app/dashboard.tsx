import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { createRoom, listOwnedRooms, type OwnedRoom } from '../../../lib/auth';

export const Route = createFileRoute('/_studio/_app/dashboard')({ component: DashboardPage });

function DashboardPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<OwnedRoom[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => listOwnedRooms().then(setRooms).catch((e: unknown) => setError(errorMessage(e))).finally(() => setLoading(false));
  useEffect(() => { void refresh(); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true); setError('');
    try {
      const room = await createRoom(name.trim());
      void navigate({ to: '/join', search: { room: room.slug, auto: true } });
    } catch (e) { setError(errorMessage(e)); }
    finally { setCreating(false); }
  };

  const active = rooms.find((room) => room.status === 'active');
  const finished = rooms.filter((room) => room.status === 'finished');

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Your rooms</h1>
      <p className="mt-2 text-sm text-ink-muted">Create a room, then open its studio when you are ready to record.</p>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5 shadow-sm sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-2">
          <span className="text-sm font-medium">Create a room</span>
          <input className="rounded-lg border border-border bg-surface px-3.5 py-2.5 outline-none focus:border-accent" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product launch" required disabled={creating} />
        </label>
        <Button type="submit" variant="primary" loading={creating}>{creating ? 'Creating…' : 'Create room'}</Button>
      </form>

      {error && <p className="mt-3 text-sm text-danger">{errorWithRoomLink(error)}</p>}
      {loading ? <p className="mt-8 text-sm text-ink-muted">Loading rooms…</p> : (
        <div className="mt-8 flex flex-col gap-6">
          <section>
            <h2 className="text-lg font-semibold">Current active room</h2>
            {active ? <RoomCard room={active} /> : <p className="mt-2 rounded-lg border border-dashed border-border p-5 text-sm text-ink-muted">No room is recording right now.</p>}
          </section>
          <section>
            <h2 className="text-lg font-semibold">Recording status</h2>
            <p className="mt-2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-ink-muted">{active?.recording ? `${active.name}: ${active.recording.status}` : 'No active recording.'}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Finished rooms</h2>
            {finished.length ? <div className="mt-2 flex flex-col gap-2">{finished.map((room) => <RoomCard key={room.id} room={room} />)}</div> : <p className="mt-2 text-sm text-ink-muted">Finished rooms will appear here.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function RoomCard({ room }: { room: OwnedRoom }) {
  return <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised p-4"><div><p className="font-medium">{room.name}</p><p className="mt-1 text-xs text-ink-muted">/{room.slug} · {room.status}</p></div>{room.status !== 'finished' && <Link to="/join" search={{ room: room.slug }} className="text-sm font-semibold text-accent hover:text-accent-hover">Open studio →</Link>}</div>;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Request failed'; }
function errorWithRoomLink(message: string) {
  const match = message.match(/active room:\s*([a-zA-Z0-9_-]+)/);
  if (!match) return message;
  return <>{message} <Link to="/join" search={{ room: match[1] }} className="font-semibold underline">Open existing room</Link></>;
}
