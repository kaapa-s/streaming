import { useEffect, useRef, useState } from 'react';
import {
  createCompositor,
  type CommentOverlay,
  type Compositor,
} from '@streaming/canvas-compositor';
import { STREAM_PROFILES } from '@streaming/stream-quality';
import type { RemotePeer } from '@streaming/sfu-client';

type ProgramPreviewInput = {
  joined: boolean;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
  name: string;
};

const PROGRAM = STREAM_PROFILES['1080p'];

/** Fit a 16:9 canvas inside the container, capped at program output resolution. */
function fitPreviewCanvasSize(
  container: HTMLElement,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } | null {
  const availW = container.clientWidth;
  const availH = container.clientHeight;
  if (availW <= 0 || availH <= 0) return null;

  const capW = Math.min(availW, maxWidth);
  const capH = Math.min(availH, maxHeight);

  let width = capW;
  let height = (width * 9) / 16;
  if (height > capH) {
    height = capH;
    width = (height * 16) / 9;
  }

  width = Math.max(320, Math.floor(width / 2) * 2);
  height = Math.max(180, Math.floor(height / 2) * 2);
  return { width, height };
}

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

    const initial = fitPreviewCanvasSize(container, PROGRAM.width, PROGRAM.height);
    const compositor = createCompositor({
      mixAudio: false,
      width: initial?.width ?? 640,
      height: initial?.height ?? 360,
      fps: PROGRAM.fps,
    });
    compositorRef.current = compositor;
    compositor.canvas.className = 'preview-canvas';
    container.appendChild(compositor.canvas);

    const syncSize = () => {
      const size = fitPreviewCanvasSize(container, PROGRAM.width, PROGRAM.height);
      if (size) compositor.resize(size.width, size.height);
    };

    syncSize();
    const observer = new ResizeObserver(() => syncSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
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

  const setPreviewOverlay = (overlay: CommentOverlay | null) => {
    compositorRef.current?.setOverlay(overlay);
  };

  return { previewRef, setPreviewOverlay };
}
