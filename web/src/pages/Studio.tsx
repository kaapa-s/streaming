import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiFetch,
  clearSession,
  getStoredUser,
  joinRoom,
  login,
  logout,
  register,
  type AuthUser,
} from '../lib/auth';
import { createCompositor, type Compositor } from '../lib/compositor';
import { SfuClient, type RemotePeer } from '../lib/sfu';
import type { StreamResolution } from '../lib/stream-quality';

const params = new URLSearchParams(location.search);
const YT_RTMP_STORAGE_KEY = 'streaming-studio-yt-rtmp';
const YT_RES_STORAGE_KEY = 'streaming-studio-resolution';

function VideoTile({
  stream,
  muted,
  label,
  sharing,
}: {
  stream: MediaStream;
  /** Local self-view: true (no mic playback). Remotes: false (hear their mic). */
  muted: boolean;
  label: string;
  sharing?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Video element is always muted + video-only — never a feedback path.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const bindVideo = () => {
      video.srcObject = new MediaStream(stream.getVideoTracks());
      video.muted = true;
      void video.play().catch(() => undefined);
    };

    bindVideo();
    stream.addEventListener('addtrack', bindVideo);
    stream.addEventListener('removetrack', bindVideo);
    return () => {
      stream.removeEventListener('addtrack', bindVideo);
      stream.removeEventListener('removetrack', bindVideo);
      video.srcObject = null;
    };
  }, [stream]);

  // Remote mic: dedicated <audio> (not the video tag). getUserMedia on join
  // unlocks autoplay-with-sound in Chromium, so play() works without mute hacks.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || muted) return;

    const bindAudio = () => {
      const tracks = stream.getAudioTracks();
      audio.srcObject = tracks.length > 0 ? new MediaStream(tracks) : null;
      if (tracks.length > 0) void audio.play().catch(() => undefined);
    };

    bindAudio();
    stream.addEventListener('addtrack', bindAudio);
    stream.addEventListener('removetrack', bindAudio);
    return () => {
      stream.removeEventListener('addtrack', bindAudio);
      stream.removeEventListener('removetrack', bindAudio);
      audio.srcObject = null;
    };
  }, [stream, muted]);

  return (
    <div className="tile">
      <video ref={videoRef} autoPlay playsInline muted />
      {!muted && <audio ref={audioRef} autoPlay />}
      <span className="tile-label">{label}</span>
      {sharing && <span className="tile-badge">Sharing</span>}
    </div>
  );
}

export function Studio() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [room] = useState(params.get('room') ?? 'main');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
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

  const name = user?.name ?? '';

  const onAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const session =
        authMode === 'register'
          ? await register(email.trim(), password, displayName.trim())
          : await login(email.trim(), password);
      setUser(session.user);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stopLocalScreen = useCallback(async () => {
    await sfuRef.current?.stopScreen();
    setLocalScreenStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const onLogout = async () => {
    await stopLocalScreen();
    sfuRef.current?.close();
    sfuRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemotePeers([]);
    setJoined(false);
    joiningRef.current = false;
    await logout();
    setUser(null);
  };

  const join = useCallback(async () => {
    if (!user || joiningRef.current) return;
    joiningRef.current = true;
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera/mic unavailable: this page must be served over HTTPS (or localhost). Open the https:// URL Vite prints.',
        );
      }
      const { joinToken, room: joinedRoom, sfuUrl } = await joinRoom(room);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setLocalStream(stream);

      const sfu = new SfuClient({ onPeersChanged: (peers) => setRemotePeers([...peers]) });
      sfuRef.current = sfu;
      await sfu.join(joinedRoom.slug, user.name, 'speaker', joinToken, sfuUrl);
      await sfu.publish(stream);
      setJoined(true);
    } catch (err) {
      sfuRef.current?.close();
      sfuRef.current = null;
      joiningRef.current = false;
      if (String(err).includes('401') || String(err).toLowerCase().includes('unauthorized')) {
        clearSession();
        setUser(null);
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [user, room]);

  // Auto-join (used by the e2e test): /?room=x&auto=1 after login
  useEffect(() => {
    if (params.get('auto') === '1' && user && !joined) void join();
  }, [join, user, joined]);

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
      {
        id: 'local',
        name,
        stream: localStream,
        ...(localScreenStream ? { screenStream: localScreenStream } : {}),
      },
      ...remotePeers,
    ]);
  }, [joined, localStream, localScreenStream, remotePeers, name]);

  const toggleScreenShare = async () => {
    setError('');
    if (localScreenStream) {
      await stopLocalScreen();
      return;
    }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser');
      }
      const sfu = sfuRef.current;
      if (!sfu) throw new Error('not connected');
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const track = screen.getVideoTracks()[0];
      if (!track) {
        screen.getTracks().forEach((t) => t.stop());
        throw new Error('no screen video track');
      }
      track.addEventListener('ended', () => {
        void stopLocalScreen();
      });
      try {
        await sfu.publishScreen(track);
      } catch (err) {
        screen.getTracks().forEach((t) => t.stop());
        throw err;
      }
      setLocalScreenStream(screen);
    } catch (err) {
      // User cancelled the picker — not an error worth showing.
      if (err instanceof DOMException && err.name === 'NotAllowedError') return;
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
      const res = await apiFetch(`/api/recordings/${action}`, {
        method: 'POST',
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
        if (body.downloadUrl) {
          setRecordingInfo(`Uploaded — ${body.downloadUrl}`);
        } else if (body.file) {
          setRecordingInfo(`Saved: ${body.file}`);
        } else {
          setRecordingInfo('');
        }
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

  if (!user) {
    return (
      <div className="lobby">
        <h1>Streaming Studio</h1>
        <p className="hint">Sign in to join room <strong>{room}</strong></p>
        <div className="auth-tabs">
          <button
            type="button"
            className={authMode === 'login' ? 'primary' : undefined}
            onClick={() => setAuthMode('login')}
          >
            Log in
          </button>
          <button
            type="button"
            className={authMode === 'register' ? 'primary' : undefined}
            onClick={() => setAuthMode('register')}
          >
            Register
          </button>
        </div>
        <form onSubmit={(e) => void onAuth(e)}>
          {authMode === 'register' && (
            <input
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            required
          />
          <input
            type="password"
            placeholder="Password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
          <button type="submit">{authMode === 'register' ? 'Create account' : 'Log in'}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="lobby">
        <h1>Streaming Studio</h1>
        <p className="hint">
          Signed in as <strong>{user.name}</strong> · Room: <strong>{room}</strong>
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <button type="submit">Join studio</button>
          <button type="button" className="danger" onClick={() => void onLogout()}>
            Log out
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
          <span className="hint">{user.name}</span>
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
          <button type="button" onClick={() => void toggleScreenShare()}>
            {localScreenStream ? 'Stop sharing' : 'Share screen'}
          </button>
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
            {localStream && (
              <VideoTile
                stream={localStream}
                muted
                label={`${name} (you)`}
                sharing={!!localScreenStream}
              />
            )}
            {remotePeers.map((peer) => (
              <VideoTile
                key={peer.id}
                stream={peer.stream}
                muted={false}
                label={peer.name}
                sharing={!!peer.screenStream}
              />
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
