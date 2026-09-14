import { Button } from '../Button';

type PlatformConnectionCardProps = {
  title: string;
  connected: boolean;
  accountLabel?: string;
  pending: boolean;
  streamKey: string;
  onStreamKeyChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  connectLabel: string;
  helperDisconnected: string;
  helperConnected: string;
  keyPlaceholder: string;
  streamControlsLocked: boolean;
};

export function PlatformConnectionCard({
  title,
  connected,
  accountLabel,
  pending,
  streamKey,
  onStreamKeyChange,
  onConnect,
  onDisconnect,
  connectLabel,
  helperDisconnected,
  helperConnected,
  keyPlaceholder,
  streamControlsLocked,
}: PlatformConnectionCardProps) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-wide uppercase text-ink-subtle">{title}</h2>
      <div className="mt-3 rounded-xl border border-border bg-surface-raised p-5 flex flex-col gap-4 shadow-sm">
        {connected ? (
          <>
            <p className="text-sm text-ink">
              Connected as <span className="font-semibold">{accountLabel ?? title}</span>
            </p>
            <Button className="self-start" loading={pending} onClick={onDisconnect}>
              Disconnect
            </Button>

            <label className="flex flex-col gap-2 pt-2 border-t border-border">
              <span className="text-sm font-medium text-ink">Default stream key (optional)</span>
              <input
                className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent font-mono text-sm"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={keyPlaceholder}
                value={streamKey}
                onChange={(e) => onStreamKeyChange(e.target.value)}
                disabled={streamControlsLocked}
              />
              <span className="text-xs text-ink-subtle leading-relaxed">{helperConnected}</span>
            </label>
          </>
        ) : (
          <>
            <p className="text-sm text-ink">
              Status: <span className="font-medium">Not connected</span>
            </p>
            <p className="text-sm text-ink-muted leading-relaxed">{helperDisconnected}</p>
            <Button
              variant="primary"
              className="self-start"
              loading={pending}
              onClick={onConnect}
            >
              {connectLabel}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
