import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
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
import { createRemoteAudioPlayer, type RemoteAudioPlayer } from '../lib/remoteAudio';
import { SfuClient, type RemotePeer } from '../lib/sfu';
import type { StreamResolution } from '../lib/stream-quality';

const params = new URLSearchParams(location.search);
const YT_RTMP_STORAGE_KEY = 'streaming-studio-yt-rtmp';
const YT_RES_STORAGE_KEY = 'streaming-studio-resolution';

/** Camera preview only — never attaches mic tracks (feedback). */
function VideoTile({
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
    <div className="tile">
      <video ref={videoRef} autoPlay playsInline muted />
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
  const [joining, setJoining] = useState(false);
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
  const [authPending, setAuthPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [screenPending, setScreenPending] = useState(false);
  const [recordingPending, setRecordingPending] = useState(false);

  const sfuRef = useRef<SfuClient | null>(null);
  const joiningRef = useRef(false);
  const compositorRef = useRef<Compositor | null>(null);
  const remoteAudioRef = useRef<RemoteAudioPlayer | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const name = user?.name ?? '';

  const onAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authPending) return;
    setAuthPending(true);
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
    } finally {
      setAuthPending(false);
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
    if (logoutPending) return;
    setLogoutPending(true);
    try {
      await stopLocalScreen();
      remoteAudioRef.current?.stop();
      sfuRef.current?.close();
      sfuRef.current = null;
      localStream?.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
      setRemotePeers([]);
      setJoined(false);
      joiningRef.current = false;
      setJoining(false);
      await logout();
      setUser(null);
    } finally {
      setLogoutPending(false);
    }
  };

  const join = useCallback(async () => {
    if (!user || joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
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
      setJoining(false);
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

  // Remote mics only — never the local stream (that is the feedback loop).
  useEffect(() => {
    if (!joined) {
      remoteAudioRef.current?.stop();
      remoteAudioRef.current = null;
      return;
    }
    const player = remoteAudioRef.current ?? createRemoteAudioPlayer();
    remoteAudioRef.current = player;
    player.setPeers(remotePeers);
  }, [joined, remotePeers]);

  useEffect(() => {
    return () => {
      remoteAudioRef.current?.stop();
      remoteAudioRef.current = null;
    };
  }, []);

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
    if (screenPending) return;
    setScreenPending(true);
    setError('');
    try {
      if (localScreenStream) {
        await stopLocalScreen();
        return;
      }
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
    } finally {
      setScreenPending(false);
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
    if (recordingPending) return;
    setRecordingPending(true);
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
    } finally {
      setRecordingPending(false);
    }
  };

  const wantsLive = !!rtmpUrl.trim();
  const actionLabel = recordingPending
    ? recording
      ? 'Stopping…'
      : wantsLive
        ? 'Going live…'
        : 'Starting…'
    : recording
      ? live
        ? 'Stop live'
        : 'Stop recording'
      : wantsLive
        ? 'Go live'
        : 'Start recording';

  const authLabel = authPending
    ? authMode === 'register'
      ? 'Creating account…'
      : 'Signing in…'
    : authMode === 'register'
      ? 'Create account'
      : 'Log in';

  const screenLabel = screenPending
    ? localScreenStream
      ? 'Stopping share…'
      : 'Starting share…'
    : localScreenStream
      ? 'Stop sharing'
      : 'Share screen';

  if (!user) {
    return (
      <div className="lobby">
        <h1>Streaming Studio</h1>
        <p className="hint">
          Sign in to join room <strong>{room}</strong>
        </p>
        <div className="auth-tabs">
          <button
            type="button"
            className={authMode === 'login' ? 'primary' : undefined}
            onClick={() => setAuthMode('login')}
            disabled={authPending}
          >
            Log in
          </button>
          <button
            type="button"
            className={authMode === 'register' ? 'primary' : undefined}
            onClick={() => setAuthMode('register')}
            disabled={authPending}
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
              disabled={authPending}
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
            disabled={authPending}
          />
          <input
            type="password"
            placeholder="Password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
            minLength={8}
            required
            disabled={authPending}
          />
          <Button type="submit" loading={authPending}>
            {authLabel}
          </Button>
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
          <Button type="submit" loading={joining}>
            {joining ? 'Joining…' : 'Join studio'}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={logoutPending}
            onClick={() => void onLogout()}
          >
            {logoutPending ? 'Logging out…' : 'Log out'}
          </Button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const streamControlsLocked = recording || recordingPending;

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
            disabled={streamControlsLocked}
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
            disabled={streamControlsLocked}
            title="Paste rtmp://a.rtmp.youtube.com/live2/<key> or just the stream key"
          />
          <Button type="button" loading={screenPending} onClick={() => void toggleScreenShare()}>
            {screenLabel}
          </Button>
          {recording && <span className="rec-dot">{live ? 'LIVE' : 'REC'}</span>}
          <Button
            variant={recording ? 'danger' : 'primary'}
            loading={recordingPending}
            onClick={() => void toggleRecording()}
          >
            {actionLabel}
          </Button>
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
                label={`${name} (you)`}
                sharing={!!localScreenStream}
              />
            )}
            {remotePeers.map((peer) => (
              <VideoTile
                key={peer.id}
                stream={peer.stream}
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
