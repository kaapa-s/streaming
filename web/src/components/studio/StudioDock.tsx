import { Camera, CameraOff, Mic, MicOff, ScreenShare, ScreenShareOff } from 'lucide-react';
import type { ReactNode } from 'react';

type StudioDockProps = {
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  screenPending: boolean;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onToggleScreenShare: () => void;
  onStopScreenShare: () => void;
};

/**
 * macOS-dock-like floating control bar for the live scene. Camera, mic and
 * screen share live here; the sources shelf sits directly above it.
 */
export function StudioDock({
  localStream,
  localScreenStream,
  screenPending,
  onToggleCamera,
  onToggleMicrophone,
  onToggleScreenShare,
  onStopScreenShare,
}: StudioDockProps) {
  const cameraOn = Boolean(localStream?.getVideoTracks()[0]?.enabled);
  const micOn = Boolean(localStream?.getAudioTracks()[0]?.enabled);
  const sharing = Boolean(localScreenStream);

  return (
    <div
      role="toolbar"
      aria-label="Stream controls"
      className="pointer-events-auto inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface-raised/95 px-2.5 py-2 shadow-lg backdrop-blur"
    >
      <DockButton
        label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        active={cameraOn}
        disabled={!localStream}
        icon={cameraOn ? <Camera size={20} /> : <CameraOff size={20} />}
        onClick={onToggleCamera}
      />
      <DockButton
        label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        active={micOn}
        disabled={!localStream}
        icon={micOn ? <Mic size={20} /> : <MicOff size={20} />}
        onClick={onToggleMicrophone}
      />
      <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />
      <DockButton
        label={sharing ? 'Stop screen share' : 'Share screen'}
        active={sharing}
        pending={screenPending}
        disabled={screenPending}
        icon={sharing ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
        onClick={sharing ? onStopScreenShare : onToggleScreenShare}
      >
        <span className="sr-only">{sharing ? 'Stop screen share' : 'Share screen'}</span>
      </DockButton>
    </div>
  );
}

function DockButton({
  label,
  icon,
  active = false,
  pending = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-11 items-center justify-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-accent/60 bg-accent/10 text-accent'
          : 'border-transparent text-ink-muted hover:bg-surface-muted hover:text-ink'
      }`}
    >
      {pending ? <span className="button-spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}
