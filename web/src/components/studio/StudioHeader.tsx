import { useEffect, useState } from 'react';
import { Button } from '../Button';

type StudioHeaderProps = {
  sessionName: string;
  recording: boolean;
  live: boolean;
  recordingPending: boolean;
  onStartRecording: () => void;
  onStop: () => void;
  onOpenGoLive: () => void;
  onLeaveSessions: () => void;
};

export function StudioHeader({
  sessionName,
  recording,
  live,
  recordingPending,
  onStartRecording,
  onStop,
  onOpenGoLive,
  onLeaveSessions,
}: StudioHeaderProps) {
  const elapsed = useElapsedLabel(recording);

  return (
    <header className="border-b border-border bg-surface-raised px-5 py-3 flex flex-col gap-3">
      <div className="flex items-center gap-4 min-w-0">
        <button
          type="button"
          onClick={onLeaveSessions}
          className="text-sm font-medium text-ink-muted hover:text-ink shrink-0"
        >
          ← Sessions
        </button>
        <h1 className="text-base font-semibold text-ink truncate">{sessionName}</h1>
        {recording && live && (
          <span className="rec-pulse text-xs font-bold tracking-widest text-live ml-auto shrink-0">
            LIVE
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {live ? (
          <Button variant="danger" loading={recordingPending} onClick={onStop}>
            <RecordingDot active />
            Stop live
            <span className="font-mono tabular-nums">{elapsed}</span>
          </Button>
        ) : recording ? (
          <Button variant="danger" loading={recordingPending} onClick={onStop}>
            <RecordingDot active />
            Stop recording
            <span className="font-mono tabular-nums">{elapsed}</span>
          </Button>
        ) : (
          <Button variant="danger" loading={recordingPending} onClick={onStartRecording}>
            <RecordingDot />
            Start recording
          </Button>
        )}

        {!live && (
          <Button disabled={recordingPending} onClick={onOpenGoLive}>
            Go live ▾
          </Button>
        )}
      </div>
    </header>
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
