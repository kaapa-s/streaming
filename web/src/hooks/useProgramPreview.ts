import { useEffect, useRef, useState } from 'react';
import { createCompositor, type Compositor } from '@streaming/canvas-compositor';
import type { RemotePeer } from '@streaming/sfu-client';

type ProgramPreviewInput = {
  joined: boolean;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
  name: string;
};

/** Program preview compositor (video only, no audio mix). */
export function useProgramPreview({
  joined,
  localStream,
  localScreenStream,
  remotePeers,
  name,
}: ProgramPreviewInput) {
  const compositorRef = useRef<Compositor | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const previewRef = (node: HTMLDivElement | null) => {
    setContainer(node);
  };

  useEffect(() => {
    if (!joined || !container) return;
    const compositor = createCompositor({ mixAudio: false });
    compositorRef.current = compositor;
    compositor.canvas.className = 'preview-canvas';
    container.appendChild(compositor.canvas);
    return () => {
      compositor.stop();
      compositor.canvas.remove();
      compositorRef.current = null;
    };
  }, [joined, container]);

  // Include `container` so peers sync after the compositor is created on /live
  // mount (join sets streams before the preview DOM exists).
  useEffect(() => {
    if (!container || !compositorRef.current || !localStream) return;
    compositorRef.current.setPeers([
      {
        id: 'local',
        name,
        stream: localStream,
        ...(localScreenStream ? { screenStream: localScreenStream } : {}),
      },
      ...remotePeers,
    ]);
  }, [container, joined, localStream, localScreenStream, remotePeers, name]);

  return { previewRef };
}
