import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { JoinLobby } from '../../components/studio/JoinLobby';
import { ensureJoinLobby } from '../../studio/studioStage';
import { useStudio } from '../../studio/useStudio';

export const Route = createFileRoute('/_studio/join')({
  beforeLoad: ({ context }) => {
    ensureJoinLobby(context.studioHandle);
  },
  component: JoinPage,
});

function JoinPage() {
  const { room, auto } = Route.useSearch();
  const s = useStudio();

  // e2e: /join?room=x&auto=1 joins as soon as the lobby is ready
  useEffect(() => {
    if (auto && s.user && !s.joined && !s.joining) void s.join();
  }, [auto, s.user, s.joined, s.joining, s.join]);

  if (!s.user) return null;
  return (
    <JoinLobby
      userName={s.user.name}
      room={room}
      joining={s.joining}
      logoutPending={s.logoutPending}
      error={s.error}
      onJoin={() => void s.join()}
      onLogout={s.onLogout}
    />
  );
}
