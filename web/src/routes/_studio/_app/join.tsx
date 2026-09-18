import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  admitInvite,
  getGuestAdmission,
  saveGuestAdmission,
  type GuestAdmission,
} from '../../../lib/auth';
import { liveStudioSearch } from '../../../lib/studioSearch';
import { ensureJoinLobby } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

/** How often an off-scene invitee re-checks whether the owner admitted them. */
const ADMIT_POLL_MS = 2000;

export const Route = createFileRoute('/_studio/_app/join')({
  beforeLoad: ({ context, search }) => ensureJoinLobby(context.studioHandle, search),
  component: RoomLobby,
});

type WaitingState = {
  slug: string;
  /** Present for guests, who must reuse the same member identity while waiting. */
  guest?: { displayName: string; guestId: string | null };
};

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
  const revalidatedInvite = useRef<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [admitting, setAdmitting] = useState(false);
  const [admittedRoom, setAdmittedRoom] = useState('');
  const [inviteError, setInviteError] = useState('');
  // Off-scene invitees wait here until the owner admits them. The SFU is not
  // contacted: a waiting member holds no join token.
  const [waiting, setWaiting] = useState<WaitingState | null>(null);

  // The poll below runs on an interval; read the latest studio and router
  // through refs so the interval does not restart on every published value.
  const studioRef = useRef(s);
  studioRef.current = s;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (s.user || !invite?.trim()) return;
    if (revalidatedInvite.current === invite) return;
    const saved = getGuestAdmission(invite);
    if (!saved || s.joining || s.joined) return;
    revalidatedInvite.current = invite;
    void (async () => {
      // Revalidate cached admissions so a deleted room cannot be reopened by a stale tab.
      const admission = await admitInvite(invite, saved.displayName, saved.guestId ?? undefined);
      if (!admission.inScene || !admission.joinToken) {
        setWaiting({ slug: admission.room.slug, guest: { displayName: saved.displayName, guestId: admission.guestId } });
        return;
      }
      await studioRef.current.joinWithAdmission(
        { room: admission.room, role: admission.role, joinToken: admission.joinToken, sfuUrl: admission.sfuUrl },
        saved.displayName,
      );
      await navigateRef.current({ to: '/live', search: { room: admission.room.slug, invite } });
    })().catch((error: unknown) => setInviteError(error instanceof Error ? error.message : String(error)));
  }, [invite, s.joined, s.joining, s.user]);

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

  useEffect(() => {
    if (!waiting || !invite?.trim()) return;
    let cancelled = false;
    let handled = false;
    const poll = async () => {
      if (handled) return;
      let admission: Awaited<ReturnType<typeof admitInvite>>;
      try {
        admission = await admitInvite(invite, waiting.guest?.displayName, waiting.guest?.guestId ?? undefined);
      } catch (error) {
        if (!cancelled) setInviteError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (cancelled || handled || !admission.inScene) return;
      handled = true;
      setWaiting(null);
      setInviteError('');
      try {
        if (waiting.guest) {
          // A guest connects through the returned SFU token, never before.
          if (!admission.joinToken) throw new Error('the host admitted you but no join token was issued');
          const next: GuestAdmission = {
            ...admission,
            invite,
            displayName: waiting.guest.displayName,
            guestId: admission.guestId,
          };
          saveGuestAdmission(next);
          await studioRef.current.joinWithAdmission(
            { room: admission.room, role: admission.role, joinToken: admission.joinToken, sfuUrl: admission.sfuUrl },
            waiting.guest.displayName,
          );
          await navigateRef.current({ to: '/live', search: { room: admission.room.slug, invite } });
          return;
        }
        setAdmittedRoom(admission.room.slug);
        await navigateRef.current({ to: '/join', search: { room: admission.room.slug } });
      } catch (error) {
        setInviteError(error instanceof Error ? error.message : String(error));
      }
    };
    const timer = window.setInterval(() => void poll(), ADMIT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [invite, waiting]);

  const submitGuest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invite) return;
    setAdmitting(true);
    setInviteError('');
    void admitInvite(invite, displayName)
      .then(async (result) => {
        const admission: GuestAdmission = {
          ...result,
          invite,
          displayName,
          guestId: result.guestId,
        };
        // Persist the guest identity so the waiting poll reuses this member.
        saveGuestAdmission(admission);
        if (!result.inScene || !result.joinToken) {
          setWaiting({ slug: result.room.slug, guest: { displayName, guestId: result.guestId } });
          return;
        }
        setAdmittedRoom(result.room.slug);
        await s.joinWithAdmission(
          { room: result.room, role: result.role, joinToken: result.joinToken, sfuUrl: result.sfuUrl },
          displayName,
        );
        await navigate({ to: '/live', search: { room: result.room.slug, invite } });
      })
      .catch((error: unknown) => setInviteError(error instanceof Error ? error.message : String(error)))
      .finally(() => setAdmitting(false));
  };

  if (!s.user && invite) {
    if (waiting?.guest) return <WaitingPanel slug={waiting.slug} error={inviteError} />;
    return <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Join room</h1>
      <p className="mt-2 text-sm text-ink-muted">Sign in to join immediately, or enter a display name to join as a guest.</p>
      <form className="mt-6 flex max-w-sm gap-2" onSubmit={submitGuest}>
        <input className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" required />
        <button className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={admitting}>{admitting ? 'Joining…' : 'Join'}</button>
      </form>
      {admittedRoom && <p className="mt-4 text-sm text-success">Access granted for /{admittedRoom}. Sign in to open the studio.</p>}
      {inviteError && <p className="mt-3 text-sm text-danger">{inviteError}</p>}
    </div>;
  }
  if (!s.user) return null;
  if (waiting) return <WaitingPanel slug={waiting.slug} error={inviteError} />;
  return <div className="max-w-xl">
    <h1 className="text-2xl font-semibold tracking-tight">Opening {room || 'room'}…</h1>
    <p className="mt-2 text-sm text-ink-muted leading-relaxed">Joining the room studio. Recording remains stopped until you start it.</p>
    {(s.error || inviteError) && <p className="mt-3 text-sm text-danger">{s.error || inviteError}</p>}
  </div>;
}
