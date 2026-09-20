import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { admitInvite } from '../../../lib/auth';
import { liveStudioSearch } from '../../../lib/studioSearch';
import { ensureJoinLobby } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

export const Route = createFileRoute('/_studio/_app/join')({
  beforeLoad: ({ context, search }) => ensureJoinLobby(context.studioHandle, search),
  component: RoomLobby,
});

function RoomLobby() {
  const { room, invite } = Route.useSearch();
  const navigate = useNavigate();
  const s = useStudio();
  const attemptedRoom = useRef<string | null>(null);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    if (!s.user || (!room.trim() && !invite?.trim())) return;
    if (s.joined && s.joinedRoom === room) {
      void navigate({ to: '/live', search: liveStudioSearch });
      return;
    }
    // Invite-only URLs have room === ''; key off the invite token so the first
    // attempt is not mistaken for the empty initial ref value.
    const attemptKey = room.trim() ? room : `invite:${invite ?? ''}`;
    if (s.joining || attemptedRoom.current === attemptKey) return;
    attemptedRoom.current = attemptKey;
    const inviteToken = invite;
    void (async () => {
      try {
        let target = room;
        if (inviteToken && !room.trim()) {
          const admitted = await admitInvite(inviteToken);
          target = admitted.room.slug;
          // Invitees join the call directly, off-scene; the owner promotes them
          // from their camera tile once they are connected.
          await navigate({ to: '/join', search: { room: target } });
          return;
        }
        if (s.joined) await s.leave();
        await s.join();
      } catch (error) {
        setInviteError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [invite, navigate, room, s]);

  if (!s.user) return null;
  return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold tracking-tight">Opening {room || 'stream'}…</h1>
    <p className="mt-2 text-sm text-ink-muted leading-relaxed">Joining the stream studio. Streaming remains stopped until you start it.</p>
    {(s.error || inviteError) && <p className="mt-3 text-sm text-danger">{s.error || inviteError}</p>}
  </div>;
}
