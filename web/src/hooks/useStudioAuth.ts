import { useState } from 'react';
import {
  getStoredUser,
  login,
  logout,
  register,
  type AuthUser,
} from '../lib/auth';
import type { AuthMode } from '../lib/authMode';
import { useAsyncAction } from './useAsyncAction';

export function useStudioAuth(setError: (message: string) => void) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const { pending: authPending, run: runAuth } = useAsyncAction();
  const { pending: logoutPending, run: runLogout } = useAsyncAction();

  const clearUser = () => {
    setUser(null);
  };

  const onAuth = (e: React.FormEvent) => {
    e.preventDefault();
    void runAuth(async () => {
      setError('');
      try {
        const session =
          authMode === 'register'
            ? await register(email.trim(), password, displayName.trim(), signupPassword)
            : await login(email.trim(), password);
        setUser(session.user);
        setPassword('');
        setSignupPassword('');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onLogout = (leave: () => Promise<void>) => {
    void runLogout(async () => {
      await leave();
      await logout();
      setUser(null);
    });
  };

  const authLabel = authPending
    ? authMode === 'register'
      ? 'Creating account…'
      : 'Signing in…'
    : authMode === 'register'
      ? 'Create account'
      : 'Log in';

  return {
    user,
    clearUser,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    signupPassword,
    setSignupPassword,
    displayName,
    setDisplayName,
    authPending,
    logoutPending,
    authLabel,
    onAuth,
    onLogout,
  };
}
