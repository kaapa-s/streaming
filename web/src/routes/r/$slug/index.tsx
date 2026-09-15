import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { getRoom, type RoomDescription } from '../../../lib/rooms';
import { useStudio } from '../../../studio/useStudio';

export const Route = createFileRoute('/r/$slug/')({
  validateSearch: (search: Record<string, unknown>) =>
    search.auto === '1' || search.auto === true ? { auto: true as const } : {},
  component: PreJoinPage,
});

function PreJoinPage() {
  const { slug } = Route.useParams();
  const { auto } = Route.useSearch();
  const navigate = useNavigate();
  const s = useStudio();
  const [room, setRoom] = useState<RoomDescription | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const description = await getRoom(slug);
        if (!cancelled) setRoom(description);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const blocked = room?.closed || room?.youAreRemoved;

  // e2e: /r/<slug>?auto=1 joins as soon as the room resolves.
  useEffect(() => {
    if (auto && room && !blocked && s.user && !s.joined && !s.joining) void s.join();
  }, [auto, room, blocked, s.user, s.joined, s.joining, s.join]);

  useEffect(() => {
    if (s.joined) void navigate({ to: '/r/$slug/live', params: { slug }, replace: true });
  }, [s.joined, navigate, slug]);

  if (!s.user) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
        {loadError && <p className="text-sm text-danger">{loadError}</p>}

        {!loadError && !room && <p className="text-sm text-ink-muted">Loading room…</p>}

        {room && (
          <>
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-ink-subtle">
              {room.youAreOwner ? 'Your stream' : `${room.ownerName} invited you`}
            </p>
            <h1 className="mt-2 text-xl font-semibold text-ink">{room.title}</h1>

            {room.closed && (
              <p className="mt-4 text-sm text-danger">
                This stream has ended. Ask the host for a new link.
              </p>
            )}
            {!room.closed && room.youAreRemoved && (
              <p className="mt-4 text-sm text-danger">
                You were removed from this room by the host.
              </p>
            )}
            {s.removedFromRoom && !blocked && (
              <p className="mt-4 text-sm text-danger">{s.removedFromRoom}</p>
            )}

            {!blocked && (
              <p className="mt-4 text-sm text-ink-muted leading-relaxed">
                You'll join with your camera and mic on. Your browser will ask for
                permission next.
              </p>
            )}

            <Button
              variant="primary"
              className="mt-6"
              loading={s.joining}
              disabled={Boolean(blocked) || s.joining}
              onClick={() => void s.join()}
            >
              {s.joining ? 'Joining…' : 'Join studio'}
            </Button>

            {s.error && <p className="mt-3 text-sm text-danger">{s.error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
