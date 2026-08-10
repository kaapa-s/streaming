import { createFileRoute } from '@tanstack/react-router';
import { AuthLobby } from '../../components/studio/AuthLobby';
import { ensureLoggedOut } from '../../studio/studioStage';
import { useStudio } from '../../studio/useStudio';

export const Route = createFileRoute('/_studio/login')({
  beforeLoad: ({ context }) => {
    ensureLoggedOut(context.studioHandle);
  },
  component: LoginPage,
});

function LoginPage() {
  const { room } = Route.useSearch();
  const s = useStudio();
  return (
    <AuthLobby
      room={room}
      authMode={s.authMode}
      onAuthModeChange={s.setAuthMode}
      email={s.email}
      onEmailChange={s.setEmail}
      password={s.password}
      onPasswordChange={s.setPassword}
      signupPassword={s.signupPassword}
      onSignupPasswordChange={s.setSignupPassword}
      displayName={s.displayName}
      onDisplayNameChange={s.setDisplayName}
      authPending={s.authPending}
      authLabel={s.authLabel}
      error={s.error}
      onSubmit={s.onAuth}
    />
  );
}
