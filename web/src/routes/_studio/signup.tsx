import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Button } from '../../components/Button';
import { keepStudioSearch } from '../../lib/studioSearch';
import { ensureLoggedOut } from '../../studio/studioStage';
import { useStudio } from '../../studio/useStudio';

export const Route = createFileRoute('/_studio/signup')({
  beforeLoad: ({ context }) => {
    ensureLoggedOut(context.studioHandle);
  },
  component: SignupPage,
});

function SignupPage() {
  const s = useStudio();

  useEffect(() => {
    s.setAuthMode('register');
  }, [s.setAuthMode]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface">
      <p className="mb-8 text-xs font-semibold tracking-[0.18em] uppercase text-ink-subtle">
        Streaming Studio
      </p>

      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Create account</h1>

        <form onSubmit={s.onAuth} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Display name</span>
            <input
              className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
              value={s.displayName}
              onChange={(e) => s.setDisplayName(e.target.value)}
              autoComplete="nickname"
              required
              disabled={s.authPending}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Email</span>
            <input
              className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
              type="email"
              value={s.email}
              onChange={(e) => s.setEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={s.authPending}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Password</span>
            <input
              className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
              type="password"
              value={s.password}
              onChange={(e) => s.setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={s.authPending}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Signup password</span>
            <input
              className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent"
              type="password"
              value={s.signupPassword}
              onChange={(e) => s.setSignupPassword(e.target.value)}
              autoComplete="off"
              required
              disabled={s.authPending}
            />
          </label>

          <Button type="submit" variant="primary" loading={s.authPending}>
            {s.authPending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        {s.error && <p className="mt-3 text-sm text-danger">{s.error}</p>}

        <p className="mt-5 text-sm text-ink-muted">
          <Link
            to="/login"
            search={keepStudioSearch}
            className="font-semibold text-accent hover:text-accent-hover"
          >
            ← Already have an account
          </Link>
        </p>
      </div>
    </div>
  );
}
