import { useCallback, useEffect, useRef } from 'react';
import { CameraOff, X } from 'lucide-react';

/** Camera preview only — never attaches mic tracks (feedback). */
export function VideoTile({
  stream,
  label,
  sharing,
  waiting,
  selected,
  onSelect,
  onRemove,
}: {
  /** Null renders a placeholder overlay: membership is known, media is not. */
  stream: MediaStream | null;
  label: string;
  sharing?: boolean;
  /** Member is connected but not on the program yet. */
  waiting?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Track add/remove can be missed by the MediaStream event when the producer
  // lands between mount and listener attach; derive a signature from render so
  // any studio re-render with new video tracks re-runs the binding effect.
  const trackIds = stream
    ? stream.getVideoTracks().map((track) => track.id).join(',')
    : '';
  const hasVideo = trackIds.length > 0;

  /**
   * Bind the stream to the element. Runs from the ref callback (so it always
   * happens when the element mounts, including React StrictMode's
   * attach/detach/attach cycle) and from track-change listeners.
   *
   * The `<video>` is always mounted (the placeholder is an overlay) so the ref
   * is never null while a stream exists; a conditional `<video>` could be
   * swapped out under StrictMode and leave `.srcObject` unset.
   */
  const bind = useCallback(
    (video: HTMLVideoElement | null = videoRef.current) => {
      if (!video) return;
      const videoTracks = stream
        ? stream.getVideoTracks().filter((track) => track.readyState !== 'ended')
        : [];
      const ids = videoTracks.map((track) => track.id).join(',');
      if (video.dataset.boundIds === ids && video.srcObject) return;
      video.dataset.boundIds = ids;

      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.srcObject = videoTracks.length > 0 ? new MediaStream(videoTracks) : null;
      if (videoTracks.length > 0) {
        void video.play().catch((err: unknown) => {
          console.warn('[VideoTile] play failed', label, err);
        });
      }
    },
    [stream, label],
  );

  const setVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element;
      bind(element);
    },
    [bind],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    bind(video);
    if (!stream) return;
    const onTrackChange = () => bind(video);
    stream.addEventListener('addtrack', onTrackChange);
    stream.addEventListener('removetrack', onTrackChange);
    return () => {
      stream.removeEventListener('addtrack', onTrackChange);
      stream.removeEventListener('removetrack', onTrackChange);
    };
  }, [stream, label, bind, trackIds]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-surface-muted aspect-video w-[140px] border-2 ${
        selected ? 'border-accent' : 'border-transparent'
      }`}
    >
      <video ref={setVideoRef} autoPlay playsInline muted className="w-full h-full object-cover block" />
      {!hasVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink-muted">
          <CameraOff size={20} strokeWidth={1.5} />
          <span className="text-[10px] font-semibold uppercase tracking-wide">Connecting…</span>
        </div>
      )}
      <span className="absolute left-1.5 bottom-1.5 max-w-[calc(100%-0.75rem)] bg-black/60 text-white px-1.5 py-0.5 rounded text-[11px] font-semibold leading-tight pointer-events-none [overflow-wrap:anywhere]">
        {label}
      </span>
      {sharing && (
        <span className="absolute top-1.5 right-1.5 bg-accent text-white px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase pointer-events-none">
          Sharing
        </span>
      )}
      {waiting && (
        <span className="absolute top-1.5 left-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white pointer-events-none">
          Waiting
        </span>
      )}
      {onSelect && (
        <button
          type="button"
          onClick={onSelect}
          aria-label={label}
          className="absolute inset-0 cursor-pointer"
        />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          title="Remove"
          className="absolute top-1.5 right-1.5 z-10 flex size-6 items-center justify-center rounded-md bg-black/70 text-white hover:bg-black"
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
