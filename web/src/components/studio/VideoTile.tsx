import { useEffect, useRef } from 'react';

/** Camera preview only — never attaches mic tracks (feedback). */
export function VideoTile({
  stream,
  label,
  sharing,
}: {
  stream: MediaStream;
  label: string;
  sharing?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Rebind only when *video* tracks change. Mic addtrack used to replace
    // srcObject and abort play(), leaving a black tile while audio still worked.
    let attachedIds = '';

    const bindVideo = () => {
      const videoTracks = stream.getVideoTracks().filter((t) => t.readyState !== 'ended');
      const ids = videoTracks.map((t) => t.id).join(',');
      if (ids === attachedIds && video.srcObject) return;
      attachedIds = ids;

      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.srcObject = videoTracks.length > 0 ? new MediaStream(videoTracks) : null;
      if (videoTracks.length > 0) {
        void video.play().catch((err: unknown) => {
          console.warn('[VideoTile] play failed', label, err);
        });
      }
    };

    bindVideo();
    stream.addEventListener('addtrack', bindVideo);
    stream.addEventListener('removetrack', bindVideo);
    return () => {
      stream.removeEventListener('addtrack', bindVideo);
      stream.removeEventListener('removetrack', bindVideo);
      video.srcObject = null;
    };
  }, [stream, label]);

  return (
    <div className="relative overflow-hidden rounded-lg bg-surface-muted aspect-video w-[140px]">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover block" />
      <span className="absolute left-1.5 bottom-1.5 bg-black/60 text-white px-1.5 py-0.5 rounded text-[11px] font-semibold">
        {label}
      </span>
      {sharing && (
        <span className="absolute top-1.5 right-1.5 bg-accent text-white px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase">
          Sharing
        </span>
      )}
    </div>
  );
}
