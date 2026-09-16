import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { admitInvite, getGuestAdmission, saveGuestAdmission } from '../../../lib/auth';
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
  const attemptedRoom = useRef('');
  const [displayName, setDisplayName] = useState('');
  const [admitting, setAdmitting] = useState(false);
  const [admittedRoom, setAdmittedRoom] = useState('');
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    if (s.user || !invite?.trim()) return;
    const saved = getGuestAdmission(invite);
    if (!saved || s.joining || s.joined) return;
    void (async () => {
      // Revalidate cached admissions so a deleted room cannot be reopened by a stale tab.
      const admission = await admitInvite(invite, saved.displayName, saved.guestId ?? undefined);
      await s.joinWithAdmission({ ...admission, room: admission.room }, saved.displayName);
      await navigate({ to: '/live', search: { room: admission.room.slug, invite } });
    })().catch((error: unknown) => setInviteError(error instanceof Error ? error.message : String(error)));
  }, [invite, navigate, s]);

  useEffect(() => {
    if (!s.user || (!room.trim() && !invite?.trim())) return;
    if (s.joined && s.joinedRoom === room) {
      void navigate({ to: '/live', search: liveStudioSearch });
      return;
    }
    if (s.joining || attemptedRoom.current === room) return;
    attemptedRoom.current = room;
    const inviteToken = invite;
    void (async () => {
      try {
        let target = room;
        if (inviteToken) {
          const admitted = await admitInvite(inviteToken);
          target = admitted.room.slug;
          setAdmittedRoom(target);
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

  if (!s.user && invite) return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold tracking-tight">Join room</h1>
    <p className="mt-2 text-sm text-ink-muted">Sign in to join immediately, or enter a display name to join as a guest.</p>
    <form className="mt-6 flex max-w-sm gap-2" onSubmit={(event) => { event.preventDefault(); setAdmitting(true); setInviteError(''); void admitInvite(invite, displayName).then(async (result) => { const admission = { ...result, invite, displayName }; saveGuestAdmission(admission); setAdmittedRoom(result.room.slug); await s.joinWithAdmission(admission, displayName); await navigate({ to: '/live', search: { room: result.room.slug, invite } }); }).catch((error: unknown) => setInviteError(error instanceof Error ? error.message : String(error))).finally(() => setAdmitting(false)); }}>
      <input className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" required />
      <button className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={admitting}>{admitting ? 'Joining…' : 'Join'}</button>
    </form>
    {admittedRoom && <p className="mt-4 text-sm text-success">Access granted for /{admittedRoom}. Sign in to open the studio.</p>}
    {inviteError && <p className="mt-3 text-sm text-danger">{inviteError}</p>}
  </div>;
  if (!s.user) return null;
  return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold tracking-tight">Opening {room || 'room'}…</h1>
    <p className="mt-2 text-sm text-ink-muted leading-relaxed">Joining the room studio. Recording remains stopped until you start it.</p>
    {(s.error || inviteError) && <p className="mt-3 text-sm text-danger">{s.error || inviteError}</p>}
  </div>;
}
