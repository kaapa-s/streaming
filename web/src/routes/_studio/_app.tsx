import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Settings, Video } from 'lucide-react';
import { Button } from '../../components/Button';
import { keepStudioSearch } from '../../lib/studioSearch';
import { ensureAuthenticated } from '../../studio/studioStage';
import { useStudio } from '../../studio/useStudio';

export const Route = createFileRoute('/_studio/_app')({
  beforeLoad: ({ context }) => {
    ensureAuthenticated(context.studioHandle);
  },
  component: AppShell,
});

function AppShell() {
  const s = useStudio();
  if (!s.user) return null;

  return (
    <div className="min-h-screen flex bg-surface text-ink">
      <aside className="w-56 shrink-0 border-r border-border bg-surface-raised flex flex-col px-4 py-5">
        <div className="px-2 mb-6">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-ink-subtle">
            Studio
          </p>
        </div>

        <nav className="flex flex-col gap-1">
          <ShellNavLink to="/join" label="New recording" icon={Video} />
        </nav>

        <div className="mt-auto flex flex-col gap-1">
          <ShellNavLink to="/settings" label="Settings" icon={Settings} />
          <div className="border-t border-border mt-2 pt-3 px-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink truncate">{s.user.name}</p>
            <Button
              variant="ghost"
              className="px-0 py-1 text-sm font-medium text-ink-muted hover:text-ink"
              loading={s.logoutPending}
              onClick={s.onLogout}
            >
              {s.logoutPending ? 'Logging out…' : 'Log out'}
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-8">
        <Outlet />
      </main>
    </div>
  );
}

function ShellNavLink({
  to,
  label,
  icon: Icon,
}: {
  to: '/join' | '/settings';
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      to={to}
      search={keepStudioSearch}
      activeOptions={{ exact: true }}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink [&.active]:bg-surface-muted [&.active]:text-ink"
    >
      <Icon size={16} strokeWidth={2} className="shrink-0" />
      {label}
    </Link>
  );
}
