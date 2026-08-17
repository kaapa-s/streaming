import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../../../components/Button';
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

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-ink-subtle">YouTube</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface-raised p-5 flex flex-col gap-4 shadow-sm">
          {s.youtubeConnected ? (
            <>
              <p className="text-sm text-ink">
                Connected as{' '}
                <span className="font-semibold">{s.youtubeAccountLabel ?? 'YouTube channel'}</span>
              </p>
              <Button
                className="self-start"
                loading={s.youtubePending}
                onClick={s.disconnectYoutube}
              >
                Disconnect
              </Button>

              <label className="flex flex-col gap-2 pt-2 border-t border-border">
                <span className="text-sm font-medium text-ink">Default stream key (optional)</span>
                <input
                  className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent font-mono text-sm"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="rtmp://… / stream key"
                  value={s.rtmpUrl}
                  onChange={(e) => s.setRtmpUrl(e.target.value)}
                  disabled={s.streamControlsLocked}
                  title="Paste rtmp://a.rtmp.youtube.com/live2/<key> or just the stream key"
                />
                <span className="text-xs text-ink-subtle leading-relaxed">
                  Saved for Go live — not used for local recording.
                </span>
              </label>
            </>
          ) : (
            <>
              <p className="text-sm text-ink">
                Status: <span className="font-medium">Not connected</span>
              </p>
              <p className="text-sm text-ink-muted leading-relaxed">
                Connect your channel to enable Go live options (stream key, live chat).
              </p>
              <Button
                variant="primary"
                className="self-start"
                loading={s.youtubePending}
                onClick={s.connectYoutube}
              >
                Connect YouTube
              </Button>
            </>
          )}
        </div>
      </section>

      {s.error && <p className="mt-4 text-sm text-danger">{s.error}</p>}
    </div>
  );
}
