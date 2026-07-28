import { useCallback, useEffect, useRef, useState } from 'react';
import { createCompositor, type Compositor } from '../lib/compositor';
import { SfuClient, type RemotePeer } from '../lib/sfu';
import type { StreamResolution } from '../lib/stream-quality';

const params = new URLSearchParams(location.search);
const YT_RTMP_STORAGE_KEY = 'streaming-studio-yt-rtmp';
const YT_RES_STORAGE_KEY = 'streaming-studio-resolution';

function VideoTile({ stream, muted, label }: { stream: MediaStream; muted: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);
  return (
    <div className="tile">
      <video ref={ref} autoPlay playsInline muted={muted} />
      <span className="tile-label">{label}</span>
    </div>
  );
}

export function Studio() {
  const [name, setName] = useState(params.get('name') ?? '');
  const [room] = useState(params.get('room') ?? 'main');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState(false);
  const [recordingInfo, setRecordingInfo] = useState('');
  const [rtmpUrl, setRtmpUrl] = useState(() => localStorage.getItem(YT_RTMP_STORAGE_KEY) ?? '');
  const [resolution, setResolution] = useState<StreamResolution>(() =>
    localStorage.getItem(YT_RES_STORAGE_KEY) === '1080p' ? '1080p' : '720p',
  );

  const sfuRef = useRef<SfuClient | null>(null);
  const joiningRef = useRef(false);
  const compositorRef = useRef<Compositor | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const join = useCallback(async () => {
    // Synchronous guard: StrictMode double-fires the auto-join effect and
    // sfuRef is only assigned after async work.
    if (!name.trim() || joiningRef.current) return;
    joiningRef.current = true;
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera/mic unavailable: this page must be served over HTTPS (or localhost). Open the https:// URL Vite prints.',
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: true,
      });
      setLocalStream(stream);

      const sfu = new SfuClient({ onPeersChanged: (peers) => setRemotePeers([...peers]) });
      sfuRef.current = sfu;
      await sfu.join(room, name.trim());
      await sfu.publish(stream);
      setJoined(true);
    } catch (err) {
      sfuRef.current?.close();
      sfuRef.current = null;
      joiningRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [name, room]);

  // Auto-join (used by the e2e test): /?room=x&name=y&auto=1
  useEffect(() => {
    if (params.get('auto') === '1' && name && !joined) void join();
  }, [join, name, joined]);

  // Program preview: same compositing code as the recorder (video only, no audio mix).
  useEffect(() => {
    if (!joined || !previewRef.current) return;
    const compositor = createCompositor({ mixAudio: false });
    compositorRef.current = compositor;
    compositor.canvas.className = 'preview-canvas';
    previewRef.current.appendChild(compositor.canvas);
    return () => {
      compositor.stop();
      compositor.canvas.remove();
      compositorRef.current = null;
    };
  }, [joined]);

  useEffect(() => {
    if (!compositorRef.current || !localStream) return;
    compositorRef.current.setPeers([
      { id: 'local', name, stream: localStream },
      ...remotePeers,
    ]);
  }, [joined, localStream, remotePeers, name]);

  const onRtmpChange = (value: string) => {
    setRtmpUrl(value);
    localStorage.setItem(YT_RTMP_STORAGE_KEY, value);
  };

  const onResolutionChange = (value: StreamResolution) => {
    setResolution(value);
    localStorage.setItem(YT_RES_STORAGE_KEY, value);
  };

  const toggleRecording = async () => {
    setError('');
    try {
      const action = recording ? 'stop' : 'start';
      const trimmed = rtmpUrl.trim();
      const res = await fetch(`/api/recordings/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          ...(action === 'start'
            ? {
                resolution,
                ...(trimmed ? { rtmpUrl: trimmed } : {}),
              }
            : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        throw new Error(msg ?? 'request failed');
      }
      const nextRecording = !recording;
      setRecording(nextRecording);
      setLive(nextRecording ? !!body.live : false);
      if (action === 'stop') {
        setRecordingInfo(body.file ? `Saved: ${body.file}` : '');
      } else {
        const resLabel = body.resolution ?? resolution;
        setRecordingInfo(
          body.live
            ? `Live on YouTube @ ${resLabel} (also recording locally)`
            : `Recording @ ${resLabel}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const wantsLive = !!rtmpUrl.trim();
  const actionLabel = recording
    ? live
      ? 'Stop live'
      : 'Stop recording'
    : wantsLive
      ? 'Go live'
      : 'Start recording';

  if (!joined) {
    return (
      <div className="lobby">
        <h1>Streaming Studio</h1>
        <p className="hint">
          Room: <strong>{room}</strong>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!name.trim()}>
            Join studio
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="studio">
      <header>
        <h1>Streaming Studio</h1>
        <div className="header-right">
          <select
            className="resolution-select"
            value={resolution}
            onChange={(e) => onResolutionChange(e.target.value as StreamResolution)}
            disabled={recording}
            title="Output resolution for recording / YouTube"
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
          <input
            className="rtmp-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="YouTube RTMP URL or stream key"
            value={rtmpUrl}
            onChange={(e) => onRtmpChange(e.target.value)}
            disabled={recording}
            title="Paste rtmp://a.rtmp.youtube.com/live2/<key> or just the stream key"
          />
          {recording && <span className="rec-dot">{live ? 'LIVE' : 'REC'}</span>}
          <button className={recording ? 'danger' : 'primary'} onClick={() => void toggleRecording()}>
            {actionLabel}
          </button>
        </div>
      </header>

      <main>
        <section className="preview-section">
          <h2>Program preview</h2>
          <div className="preview" ref={previewRef} />
        </section>

        <section>
          <h2>Speakers</h2>
          <div className="tiles">
            {localStream && <VideoTile stream={localStream} muted label={`${name} (you)`} />}
            {remotePeers.map((peer) => (
              <VideoTile key={peer.id} stream={peer.stream} muted={false} label={peer.name} />
            ))}
          </div>
        </section>
      </main>

      <footer>
        {error && <span className="error">{error}</span>}
        {recordingInfo && <span className="hint">{recordingInfo}</span>}
      </footer>
    </div>
  );
}
