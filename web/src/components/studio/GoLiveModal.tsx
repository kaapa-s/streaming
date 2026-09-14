import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { keepStudioSearch } from '../../lib/studioSearch';
import {
  PLATFORM_META,
  PLATFORM_PROVIDERS,
  type OutboundDestination,
  type PlatformProvider,
  type PlatformStatus,
} from '../../lib/platforms';
import { Button } from '../Button';

type GoLiveModalProps = {
  platforms: Record<PlatformProvider, PlatformStatus>;
  streamKeys: Record<PlatformProvider, string>;
  pending: boolean;
  onClose: () => void;
  onGoLive: (destinations: OutboundDestination[]) => void;
};

export function GoLiveModal({
  platforms,
  streamKeys,
  pending,
  onClose,
  onGoLive,
}: GoLiveModalProps) {
  const [selected, setSelected] = useState<Record<PlatformProvider, boolean>>(() => {
    const initial = {} as Record<PlatformProvider, boolean>;
    for (const id of PLATFORM_PROVIDERS) {
      initial[id] = platforms[id].connected && Boolean(streamKeys[id].trim());
    }
    return initial;
  });
  const [keys, setKeys] = useState<Record<PlatformProvider, string>>(() => ({ ...streamKeys }));

  const destinations = useMemo(() => {
    const out: OutboundDestination[] = [];
    for (const id of PLATFORM_PROVIDERS) {
      if (!selected[id] || !platforms[id].connected) continue;
      const streamKey = keys[id].trim();
      if (!streamKey) continue;
      out.push({ platform: id, streamKey });
    }
    return out;
  }, [selected, keys, platforms]);

  const anyConnected = PLATFORM_PROVIDERS.some((id) => platforms[id].connected);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="go-live-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface-raised p-6 shadow-lg flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="go-live-title" className="text-lg font-semibold text-ink">
          Go live
        </h2>

        {!anyConnected ? (
          <>
            <p className="text-sm text-ink-muted leading-relaxed">
              Connect a destination in Settings to enable Go live (stream key per platform).
            </p>
            <div className="flex gap-2 justify-end">
              <Button onClick={onClose}>Cancel</Button>
              <Link to="/settings" search={keepStudioSearch}>
                <Button variant="primary">Open Settings</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Select one or more destinations. ffmpeg will push to all of them at once.
            </p>
            <ul className="flex flex-col gap-3">
              {PLATFORM_PROVIDERS.map((id) => {
                const meta = PLATFORM_META[id];
                const status = platforms[id];
                const enabled = status.connected;
                return (
                  <li
                    key={id}
                    className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2"
                  >
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={Boolean(selected[id] && enabled)}
                        disabled={!enabled || pending}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [id]: e.target.checked }))
                        }
                      />
                      <span className="font-medium">{meta.label}</span>
                      {enabled ? (
                        <span className="text-ink-muted">
                          · {status.accountLabel ?? meta.accountFallback}
                        </span>
                      ) : (
                        <Link
                          to="/settings"
                          search={keepStudioSearch}
                          className="ml-auto text-sm text-accent hover:underline"
                        >
                          Connect in Settings
                        </Link>
                      )}
                    </label>
                    {enabled && selected[id] && (
                      <input
                        className="rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-ink outline-none focus:border-accent font-mono text-sm"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={keys[id]}
                        onChange={(e) =>
                          setKeys((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                        placeholder={meta.keyPlaceholder}
                        disabled={pending}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-2 justify-end pt-1">
              <Button onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={destinations.length === 0}
                onClick={() => onGoLive(destinations)}
              >
                Go live
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
