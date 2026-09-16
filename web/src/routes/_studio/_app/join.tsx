import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../../../components/Button';
import { ensureJoinLobby } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

export const Route = createFileRoute('/_studio/_app/join')({
  beforeLoad: ({ context }) => ensureJoinLobby(context.studioHandle),
  component: RoomLobby,
});

function RoomLobby() {
  const { room } = Route.useSearch();
  const s = useStudio();
  if (!s.user) return null;
  return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold tracking-tight">{room || 'Room'}</h1>
    <p className="mt-2 text-sm text-ink-muted leading-relaxed">Open this room to join the studio. Recording remains stopped until you start it from the studio.</p>
    <div className="mt-8 rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
      <Button variant="primary" loading={s.joining} disabled={!room.trim()} onClick={() => void s.join()}>{s.joining ? 'Joining…' : 'Open room'}</Button>
      {!room && <p className="mt-3 text-sm text-danger">Select a room from the sidebar.</p>}
      {s.error && <p className="mt-3 text-sm text-danger">{s.error}</p>}
    </div>
  </div>;
}
