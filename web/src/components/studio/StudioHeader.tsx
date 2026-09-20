import { useEffect, useState, type ReactNode } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { Button } from '../Button';
import { streamStatusLabel } from '../../lib/streamLabels';

type StudioHeaderProps = {
  sessionName: string;
  streaming: boolean;
  live: boolean;
  pending: boolean;
  onStartStream: () => void;
  onStop: () => void;
  onOpenInvites: () => void;
  onLeaveSessions: () => void;
  roomStatus: 'created' | 'active' | 'finished' | null;
  isRoomOwner: boolean;
  onDiscard: () => void;
};

export function StudioHeader({
  sessionName,
  streaming,
  live,
  pending,
  onStartStream,
  onStop,
  onOpenInvites,
  onLeaveSessions,
  roomStatus,
  isRoomOwner,
  onDiscard,
}: StudioHeaderProps) {
  const elapsed = useElapsedLabel(streaming);
  const statusLabel = streamStatusLabel(roomStatus, { active: streaming, live });

  return (
    <header className="border-b border-border bg-surface-raised px-5 py-3 flex items-center gap-4 min-w-0">
      <button
        type="button"
        onClick={onLeaveSessions}
        className="text-sm font-medium text-ink-muted hover:text-ink shrink-0"
      >
        ← Streams
      </button>
      <h1 className="text-base font-semibold text-ink truncate">{sessionName}</h1>
      <span
        className={`text-xs font-bold tracking-widest shrink-0 ${
          streaming ? `text-live ${live ? 'rec-pulse' : ''}` : 'text-ink-subtle'
        }`}
      >
        {statusLabel}
      </span>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {isRoomOwner ? (
          <>
            {streaming ? (
              <Button variant="danger" loading={pending} onClick={onStop}>
                <RecordingDot active />
                Stop streaming
                <span className="font-mono tabular-nums">{elapsed}</span>
              </Button>
            ) : (
              <Button variant="danger" loading={pending} onClick={onStartStream}>
                <RecordingDot />
                Start streaming
              </Button>
            )}
            <IconAction
              label="Invite"
              disabled={pending}
              onClick={onOpenInvites}
              icon={<UserPlus size={18} />}
            />
            {roomStatus === 'created' && !streaming && (
              <IconAction
                label="Discard stream"
                danger
                disabled={pending}
                onClick={onDiscard}
                icon={<Trash2 size={18} />}
              />
            )}
          </>
        ) : (
          <span className="text-xs text-ink-muted">
            {live
              ? 'The host is live — you are following their program.'
              : streaming
                ? 'The host is streaming — you are following their program.'
                : 'Waiting for the host to start.'}
          </span>
        )}
      </div>
    </header>
  );
}

function IconAction({
  label,
  icon,
  danger = false,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-9 items-center justify-center rounded-lg border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-danger hover:border-danger/50 hover:bg-danger/10'
          : 'text-ink-muted hover:border-border hover:bg-surface-muted hover:text-ink'
      }`}
    >
      {icon}
    </button>
  );
}

function useElapsedLabel(active: boolean): string {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function RecordingDot({ active = false }: { active?: boolean }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full bg-white ${active ? 'rec-pulse' : 'opacity-80'}`}
      aria-hidden
    />
  );
}
