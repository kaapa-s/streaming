import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { useLocalStorageState } from '../../../hooks/useLocalStorageState';
import { SESSION_NAME_KEY } from '../../../lib/sessionName';
import { ensureJoinLobby } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

export const Route = createFileRoute('/_studio/_app/join')({
  beforeLoad: ({ context }) => {
    ensureJoinLobby(context.studioHandle);
  },
  component: NewRecordingPage,
});

function NewRecordingPage() {
  const { room, auto } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const s = useStudio();
  const [sessionName, setSessionName] = useLocalStorageState(SESSION_NAME_KEY, defaultSessionName());
  const [roomDraft, setRoomDraft] = useState(room);
  const [showAdvanced, setShowAdvanced] = useState(room !== 'main');

  useEffect(() => {
    setRoomDraft(room);
  }, [room]);

  // e2e: /join?room=x&auto=1 joins as soon as the lobby is ready
  useEffect(() => {
    if (auto && s.user && !s.joined && !s.joining) void s.join();
  }, [auto, s.user, s.joined, s.joining, s.join]);

  if (!s.user) return null;

  const enterStudio = (e: React.FormEvent) => {
    e.preventDefault();
    const nextRoom = roomDraft.trim() || 'main';
    if (nextRoom !== room) {
      void navigate({
        search: (prev) => ({ ...prev, room: nextRoom, auto: true }),
        replace: true,
      });
      return;
    }
    void s.join();
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">New recording</h1>
      <p className="mt-2 text-sm text-ink-muted leading-relaxed">
        Start a session to record locally. You can go live to YouTube later from studio.
      </p>

      <form
        onSubmit={enterStudio}
        className="mt-8 rounded-xl border border-border bg-surface-raised p-6 flex flex-col gap-5 shadow-sm"
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Session name</span>
          <input
            className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="Tuesday studio"
            autoComplete="off"
            required
            disabled={s.joining}
          />
        </label>

        <div>
          <button
            type="button"
            className="text-sm font-medium text-ink-muted hover:text-ink"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide' : 'Show'} room / invite code
          </button>
          {showAdvanced && (
            <label className="mt-3 flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">Room / invite code</span>
              <input
                className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
                value={roomDraft}
                onChange={(e) => setRoomDraft(e.target.value)}
                placeholder="main"
                autoComplete="off"
                disabled={s.joining}
              />
            </label>
          )}
        </div>

        <Button type="submit" variant="primary" loading={s.joining} className="self-start">
          {s.joining ? 'Entering…' : 'Enter studio'}
        </Button>

        {s.error && <p className="text-sm text-danger">{s.error}</p>}
      </form>
    </div>
  );
}

function defaultSessionName(): string {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date());
  return `${weekday} studio`;
}
