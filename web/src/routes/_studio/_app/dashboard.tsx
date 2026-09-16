import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { createRoom, discardRoom, listOwnedRooms, type OwnedRoom } from '../../../lib/auth';

export const Route = createFileRoute('/_studio/_app/dashboard')({ component: DashboardPage });

function DashboardPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<OwnedRoom[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = () => listOwnedRooms().then(setRooms).catch((e: unknown) => setError(errorMessage(e))).finally(() => setLoading(false));
  useEffect(() => { void refresh(); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true); setError('');
    try {
      const room = await createRoom(name.trim());
      void navigate({ to: '/join', search: { room: room.slug } });
    } catch (e) { setError(errorMessage(e)); }
    finally { setCreating(false); }
  };

  const active = rooms.find((room) => room.status === 'active' || room.status === 'created');
  const finished = rooms.filter((room) => room.status === 'finished');
  const discard = async (room: OwnedRoom) => {
    if (room.status !== 'created' || !window.confirm(`Discard “${room.name}”? This permanently deletes the room and its invites.`)) return;
    setError(''); setDiscarding(room.slug);
    try { await discardRoom(room.slug); await refresh(); } catch (e) { setError(errorMessage(e)); }
    finally { setDiscarding(null); }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Add a room</h1>
      <p className="mt-2 text-sm text-ink-muted">Your new room opens immediately. Recording stays stopped until you start it.</p>

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
            <h2 className="text-lg font-semibold">Current room</h2>
            {active ? <RoomCard room={active} onDiscard={discard} discarding={discarding === active.slug} /> : <p className="mt-2 rounded-lg border border-dashed border-border p-5 text-sm text-ink-muted">No current room. Create one above.</p>}
          </section>
          <section>
            <h2 className="text-lg font-semibold">Recording status</h2>
            <p className="mt-2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-ink-muted">{active?.media ? `${active.name}: ${active.media.status}` : 'Recording stopped.'}</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Finished rooms</h2>
            {finished.length ? <div className="mt-2 flex flex-col gap-2">{finished.map((room) => <RoomCard key={room.id} room={room} />)}</div> : <p className="mt-2 text-sm text-ink-muted">Finished rooms appear in the sidebar.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, onDiscard, discarding = false }: { room: OwnedRoom; onDiscard?: (room: OwnedRoom) => void; discarding?: boolean }) {
  return <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised p-4"><div><p className="font-medium">{room.name}</p><p className="mt-1 text-xs text-ink-muted">/{room.slug} · {room.status}</p></div>{room.status === 'created' && onDiscard && <Button type="button" variant="danger" loading={discarding} disabled={discarding} onClick={() => void onDiscard(room)}>{discarding ? 'Discarding…' : 'Discard'}</Button>}</div>;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Request failed'; }
function errorWithRoomLink(message: string) {
  const match = message.match(/(?:active|current) room:\s*([a-zA-Z0-9_-]+)/);
  if (!match) return message;
  return <>{message} <Link to="/join" search={{ room: match[1] }} className="font-semibold underline">Open existing room</Link></>;
}
