import { useEffect, useRef, useState } from 'react';
import { createCompositor } from '../lib/compositor';
import { SfuClient } from '../lib/sfu';
import { parseResolution, pickRecorderFormat, STREAM_PROFILES } from '../lib/stream-quality';

/**
 * Hidden recorder page, loaded by the server's headless Chromium at
 * /compositor?room=X&resolution=720p|1080p. Joins the room subscribe-only,
 * composites all speakers, records the composite with MediaRecorder and
 * streams webm chunks to the server over /ws/recording.
 * The server stops it via window.__stopRecording().
 */
export function CompositorPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('starting…');
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !containerRef.current) return;
    startedRef.current = true;
    const container = containerRef.current;

    const run = async () => {
      const params = new URLSearchParams(location.search);
      const room = params.get('room') ?? 'main';
      const token = params.get('token');
      if (!token) throw new Error('missing join token');
      const sfuUrl = params.get('sfuUrl') ?? undefined;
      const resolution = parseResolution(params.get('resolution'));
      const profile = STREAM_PROFILES[resolution];

      const compositor = createCompositor({
        width: profile.width,
        height: profile.height,
        fps: profile.fps,
        mixAudio: true,
      });
      compositor.canvas.style.width = '100%';
      container.appendChild(compositor.canvas);

      const sfu = new SfuClient({ onPeersChanged: (peers) => compositor.setPeers(peers) });
      await sfu.join(room, 'Recorder', 'compositor', token, sfuUrl);
      setStatus(`joined room "${room}" (${resolution}), connecting recorder…`);

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const { mimeType, codec } = pickRecorderFormat();
      const ws = new WebSocket(
        `${proto}//${location.host}/ws/recording` +
          `?room=${encodeURIComponent(room)}&codec=${encodeURIComponent(codec)}`,
      );
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('recording sink connection failed'));
      });

      const recorder = new MediaRecorder(compositor.stream, {
        mimeType,
        videoBitsPerSecond: profile.recorderVideoBps,
        audioBitsPerSecond: profile.recorderAudioBps,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      // 500ms chunks: slightly smoother for ffmpeg than 1s, still low overhead.
      recorder.start(500);
      setStatus(`recording room "${room}" @ ${resolution} (${mimeType})`);
      console.log(
        `[compositor] recording started for room ${room} @ ${resolution} ` +
          `${profile.width}x${profile.height} ${mimeType} codec=${codec} video=${profile.recorderVideoBps}`,
      );

      window.__stopRecording = () =>
        new Promise<void>((resolve) => {
          recorder.onstop = () => {
            // Give the final ondataavailable chunk a moment to be sent,
            // then close the socket so the server finalizes the file.
            setTimeout(() => {
              ws.close();
              sfu.close();
              compositor.stop();
              resolve();
            }, 300);
          };
          recorder.stop();
        });
    };

    run().catch((err) => {
      console.error('[compositor] failed:', err);
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif', color: '#ccc', background: '#111' }}>
      <p>{status}</p>
      <div ref={containerRef} />
    </div>
  );
}
