import { Link, Outlet, createFileRoute, useLocation } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Settings, Plus } from 'lucide-react';
import { Button } from '../../components/Button';
import { listOwnedRooms, type OwnedRoom } from '../../lib/auth';
import { keepStudioSearch } from '../../lib/studioSearch';
import { ensureAuthenticated } from '../../studio/studioStage';
import { useStudio } from '../../studio/useStudio';

export const Route = createFileRoute('/_studio/_app')({
  beforeLoad: ({ context }) => ensureAuthenticated(context.studioHandle),
  component: AppShell,
});

function AppShell() {
  const s = useStudio();
  const location = useLocation();
  const [rooms, setRooms] = useState<OwnedRoom[]>([]);
  useEffect(() => { void listOwnedRooms().then(setRooms).catch(() => undefined); }, [s.joined, location.pathname]);
  if (!s.user && !s.joined) return null;
  const current = rooms.find((room) => room.status === 'created' || room.status === 'active');
  const finished = rooms.filter((room) => room.status === 'finished');

  return <div className="min-h-screen flex bg-surface text-ink">
    <aside className="w-64 shrink-0 border-r border-border bg-surface-raised flex flex-col px-4 py-5">
      <div className="px-2 mb-6"><p className="text-xs font-semibold tracking-[0.14em] uppercase text-ink-subtle">Rooms</p></div>
      <nav className="flex flex-col gap-1">
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Current room</p>
        {current ? <RoomLink room={current} /> : <Link to="/dashboard" search={keepStudioSearch} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-muted"><Plus size={16} /> Add new room</Link>}
        {finished.length > 0 && <p className="mt-5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Finished rooms</p>}
        {finished.map((room) => <RoomLink key={room.id} room={room} />)}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <Link to="/settings" search={keepStudioSearch} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"><Settings size={16} /> Settings</Link>
        <div className="border-t border-border mt-2 pt-3 px-2 flex items-center justify-between"><p className="text-sm font-semibold truncate">{s.user?.name ?? 'Guest'}</p><Button variant="ghost" className="px-0 py-1 text-sm font-medium text-ink-muted hover:text-ink" loading={s.logoutPending} onClick={s.onLogout}>{s.logoutPending ? 'Logging out…' : 'Log out'}</Button></div>
      </div>
    </aside>
    <main className="flex-1 min-w-0 p-8"><Outlet /></main>
  </div>;
}

function RoomLink({ room }: { room: OwnedRoom }) {
  const label = room.status === 'created'
    ? 'Not started'
    : room.status === 'active'
      ? 'Recording'
      : room.media?.status === 'failed'
        ? 'Failed'
        : room.media?.status === 'uploading' || room.media?.status === 'stopping'
          ? 'Processing'
          : 'Finished';
  const failing = room.media?.status === 'failed';
  const chip = room.status === 'active'
    ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent"><span className="inline-block size-1.5 rounded-full bg-accent" />{label}</span>
    : <span className={`inline-flex items-center gap-1.5 text-xs ${failing ? 'font-semibold text-danger' : room.status === 'finished' ? 'text-ink-subtle' : 'text-ink-muted'}`}><span className={`inline-block size-1.5 rounded-full ${failing ? 'bg-danger' : 'bg-ink-subtle opacity-60'}`} />{label}</span>;
  if (room.status === 'finished') return <Link to="/rooms/$slug" params={{ slug: room.slug }} search={keepStudioSearch} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"><span className="block truncate">{room.name}</span>{chip}</Link>;
  return <Link to="/join" search={{ room: room.slug }} className="rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-surface-muted"><span className="block truncate">{room.name}</span>{chip}</Link>;
}
