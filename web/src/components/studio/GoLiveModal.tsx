import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../Button';
import { keepStudioSearch } from '../../lib/studioSearch';

type GoLiveModalProps = {
  youtubeConnected: boolean;
  youtubeAccountLabel?: string;
  defaultStreamKey: string;
  pending: boolean;
  onClose: () => void;
  onGoLive: (streamKey: string, pullChat: boolean) => void;
};

export function GoLiveModal({
  youtubeConnected,
  youtubeAccountLabel,
  defaultStreamKey,
  pending,
  onClose,
  onGoLive,
}: GoLiveModalProps) {
  const [streamKey, setStreamKey] = useState(defaultStreamKey);
  const [pullChat, setPullChat] = useState(false);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="go-live-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-6 shadow-lg flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="go-live-title" className="text-lg font-semibold text-ink">
          Go live
        </h2>

        {!youtubeConnected ? (
          <>
            <p className="text-sm text-ink-muted leading-relaxed">
              Connect your YouTube channel in Settings to enable Go live options (stream key, live
              chat).
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
            <p className="text-sm text-ink">
              YouTube · <span className="font-semibold">{youtubeAccountLabel ?? 'Connected'}</span>
            </p>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Stream key</span>
              <input
                className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-ink outline-none focus:border-accent font-mono text-sm"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={streamKey}
                onChange={(e) => setStreamKey(e.target.value)}
                placeholder="rtmp://… / stream key"
                disabled={pending}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={pullChat}
                onChange={(e) => setPullChat(e.target.checked)}
                disabled={pending}
              />
              Pull live chat / comments
            </label>

            <div className="flex gap-2 justify-end pt-1">
              <Button onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={!streamKey.trim()}
                onClick={() => onGoLive(streamKey.trim(), pullChat)}
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
