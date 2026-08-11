import { useEffect, useRef, useState } from 'react';
import { createCompositor } from '@streaming/canvas-compositor';
import { SfuClient } from '@streaming/sfu-client';
import { parseResolution, pickRecorderFormat, STREAM_PROFILES } from '@streaming/stream-quality';

/**
 * Hidden recorder page, loaded by the compositor service's headless Chromium.
 * Query: room, resolution, token, mode=idle|record, sinkUrl, sfuUrl?
 *
 * Idle (warmup): joins SFU + renders; exposes __startRecording / __stopRecording.
 * Recording starts only when the service calls __startRecording().
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
      const sinkUrlParam = params.get('sinkUrl');
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

      window.__setOverlay = (overlay) => {
        compositor.setOverlay(overlay);
      };
      window.__clearOverlay = () => {
        compositor.setOverlay(null);
      };

      const sfu = new SfuClient({ onPeersChanged: (peers) => compositor.setPeers(peers) });
      await sfu.join(room, 'Recorder', 'compositor', token, sfuUrl);
      setStatus(`warmed room "${room}" (${resolution}) — waiting for go-live`);

      let recorder: MediaRecorder | undefined;
      let ws: WebSocket | undefined;

      window.__startRecording = async (opts?: { requireH264?: boolean }) => {
        if (recorder && recorder.state !== 'inactive') {
          throw new Error('already recording');
        }
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const sinkUrl =
          sinkUrlParam ??
          `${proto}//${location.host}/ws/recording` +
            `?room=${encodeURIComponent(room)}`;

        const { mimeType, codec } = pickRecorderFormat({
          requireH264: opts?.requireH264,
        });
        const sinkWithCodec = sinkUrl.includes('?')
          ? `${sinkUrl}&codec=${encodeURIComponent(codec)}`
          : `${sinkUrl}?room=${encodeURIComponent(room)}&codec=${encodeURIComponent(codec)}`;

        ws = new WebSocket(sinkWithCodec);
        await new Promise<void>((resolve, reject) => {
          if (!ws) return reject(new Error('ws missing'));
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('recording sink connection failed'));
        });

        await compositor.ensureAudio();
        const audioTracks = compositor.stream.getAudioTracks();
        if (audioTracks.length === 0) {
          console.error('[compositor] output stream has no audio track — RTMP will be silent');
        }

        recorder = new MediaRecorder(compositor.stream, {
          mimeType,
          videoBitsPerSecond: profile.recorderVideoBps,
          audioBitsPerSecond: profile.recorderAudioBps,
        });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws?.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        recorder.start(500);
        setStatus(`recording room "${room}" @ ${resolution} (${mimeType})`);
        console.log(
          `[compositor] recording started for room ${room} @ ${resolution} ` +
            `${profile.width}x${profile.height} ${mimeType} codec=${codec} ` +
            `video=${profile.recorderVideoBps} audioTracks=${audioTracks.length}`,
        );
      };

      window.__stopRecording = () =>
        new Promise<void>((resolve) => {
          const finish = () => {
            setTimeout(() => {
              ws?.close();
              ws = undefined;
              sfu.close();
              compositor.stop();
              recorder = undefined;
              resolve();
            }, 300);
          };
          if (!recorder || recorder.state === 'inactive') {
            finish();
            return;
          }
          recorder.onstop = () => finish();
          recorder.stop();
        });

      // Legacy: mode=record starts immediately (e2e / old callers).
      if (params.get('mode') === 'record') {
        await window.__startRecording();
      }
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
