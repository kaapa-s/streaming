import { Button } from '../Button';

export type AuthMode = 'login' | 'register';

type AuthLobbyProps = {
  room: string;
  authMode: AuthMode;
  onAuthModeChange: (mode: AuthMode) => void;
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  signupPassword: string;
  onSignupPasswordChange: (value: string) => void;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  authPending: boolean;
  authLabel: string;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
};

export function AuthLobby({
  room,
  authMode,
  onAuthModeChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  signupPassword,
  onSignupPasswordChange,
  displayName,
  onDisplayNameChange,
  authPending,
  authLabel,
  error,
  onSubmit,
}: AuthLobbyProps) {
  return (
    <div className="lobby">
      <h1>Streaming Studio</h1>
      <p className="hint">
        Sign in to join room <strong>{room}</strong>
      </p>
      <div className="auth-tabs">
        <button
          type="button"
          className={authMode === 'login' ? 'primary' : undefined}
          onClick={() => onAuthModeChange('login')}
          disabled={authPending}
        >
          Log in
        </button>
        <button
          type="button"
          className={authMode === 'register' ? 'primary' : undefined}
          onClick={() => onAuthModeChange('register')}
          disabled={authPending}
        >
          Register
        </button>
      </div>
      <form onSubmit={onSubmit}>
        {authMode === 'register' && (
          <input
            placeholder="Display name"
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            autoComplete="nickname"
            required
            disabled={authPending}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          autoComplete="email"
          autoFocus
          required
          disabled={authPending}
        />
        <input
          type="password"
          placeholder="Password (min 8)"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
          minLength={8}
          required
          disabled={authPending}
        />
        {authMode === 'register' && (
          <input
            type="password"
            placeholder="Signup password"
            value={signupPassword}
            onChange={(e) => onSignupPasswordChange(e.target.value)}
            autoComplete="off"
            required
            disabled={authPending}
          />
        )}
        <Button type="submit" loading={authPending}>
          {authLabel}
        </Button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
