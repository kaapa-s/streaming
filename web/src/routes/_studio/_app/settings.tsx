import { createFileRoute } from '@tanstack/react-router';
import { PlatformConnectionCard } from '../../../components/studio/PlatformConnectionCard';
import { PLATFORM_META, PLATFORM_PROVIDERS } from '../../../lib/platforms';
import { ensureAuthenticated } from '../../../studio/studioStage';
import { useStudio } from '../../../studio/useStudio';

export const Route = createFileRoute('/_studio/_app/settings')({
  beforeLoad: ({ context }) => {
    ensureAuthenticated(context.studioHandle);
  },
  component: SettingsPage,
});

function SettingsPage() {
  const s = useStudio();
  if (!s.user) return null;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-ink-subtle">Account</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface-raised px-5 py-4 shadow-sm">
          <p className="text-sm text-ink">
            <span className="font-semibold">{s.user.name}</span>
            <span className="text-ink-muted"> · {s.user.email}</span>
          </p>
        </div>
      </section>

      {PLATFORM_PROVIDERS.map((id) => {
        const meta = PLATFORM_META[id];
        const status = s.platforms[id];
        return (
          <PlatformConnectionCard
            key={id}
            title={meta.label}
            connected={status.connected}
            accountLabel={status.accountLabel ?? meta.accountFallback}
            pending={s.platformPending === id}
            streamKey={s.streamKeys[id]}
            onStreamKeyChange={(value) => s.setStreamKey(id, value)}
            onConnect={() => s.connectPlatform(id)}
            onDisconnect={() => s.disconnectPlatform(id)}
            connectLabel={meta.connectLabel}
            helperDisconnected={meta.disconnectedHelp}
            helperConnected={meta.connectedHelp}
            keyPlaceholder={meta.keyPlaceholder}
            streamControlsLocked={s.streamControlsLocked}
          />
        );
      })}

      {s.error && <p className="mt-4 text-sm text-danger">{s.error}</p>}
    </div>
  );
}
