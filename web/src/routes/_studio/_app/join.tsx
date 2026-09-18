import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { admitInvite } from '../../../lib/auth';
import { liveStudioSearch } from '../../../lib/studioSearch';
import { ensureJoinLobby } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

/** How often an off-scene invitee re-checks whether the owner admitted them. */
const ADMIT_POLL_MS = 2000;

export const Route = createFileRoute('/_studio/_app/join')({
  beforeLoad: ({ context, search }) => ensureJoinLobby(context.studioHandle, search),
  component: RoomLobby,
});

function WaitingPanel({ slug, error }: { slug: string; error: string }) {
  return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold tracking-tight">Waiting for the host to admit you</h1>
    <p className="mt-2 text-sm text-ink-muted leading-relaxed">
      You are off-scene in /{slug}. The host will admit you to the program shortly; this page checks automatically.
    </p>
    {error && <p className="mt-3 text-sm text-danger">{error}</p>}
  </div>;
}

function RoomLobby() {
  const { room, invite } = Route.useSearch();
  const navigate = useNavigate();
  const s = useStudio();
  const attemptedRoom = useRef<string | null>(null);
  const [inviteError, setInviteError] = useState('');
  // Off-scene invitees wait here until the owner admits them. The SFU is not
  // contacted: a waiting member holds no join token.
  const [waiting, setWaiting] = useState<{ slug: string } | null>(null);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

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
          // An invitee starts off-scene; wait for the owner instead of joining.
          if (!admitted.inScene) {
            setWaiting({ slug: target });
            return;
          }
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

  useEffect(() => {
    if (!waiting || !invite?.trim()) return;
    let cancelled = false;
    let handled = false;
    const poll = async () => {
      if (handled) return;
      let admission: Awaited<ReturnType<typeof admitInvite>>;
      try {
        admission = await admitInvite(invite);
      } catch (error) {
        if (!cancelled) setInviteError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (cancelled || handled || !admission.inScene) return;
      handled = true;
      setWaiting(null);
      setInviteError('');
      await navigateRef.current({ to: '/join', search: { room: admission.room.slug } });
    };
    const timer = window.setInterval(() => void poll(), ADMIT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [invite, waiting]);

  if (!s.user) return null;
  if (waiting) return <WaitingPanel slug={waiting.slug} error={inviteError} />;
  return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold tracking-tight">Opening {room || 'room'}…</h1>
    <p className="mt-2 text-sm text-ink-muted leading-relaxed">Joining the room studio. Recording remains stopped until you start it.</p>
    {(s.error || inviteError) && <p className="mt-3 text-sm text-danger">{s.error || inviteError}</p>}
  </div>;
}
