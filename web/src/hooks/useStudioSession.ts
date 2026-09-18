import { useRef, useState } from 'react';
import { SfuClient, type RemotePeer } from '@streaming/sfu-client';
import { clearSession, joinRoom, type AuthUser } from '../lib/auth';
import { useAsyncAction } from './useAsyncAction';

type StudioDiagnostics = {
  localPeerId: string | null;
  localName: string | null;
  peers: RemotePeer[];
};

type DiagnosticsWindow = Window & { __studioDiagnostics?: StudioDiagnostics };

type UseStudioSessionArgs = {
  user: AuthUser | null;
  room: string;
  setError: (message: string) => void;
  onUnauthorized: () => void;
};

export function useStudioSession({
  user,
  room,
  setError,
  onUnauthorized,
}: UseStudioSessionArgs) {
  const [joined, setJoined] = useState(false);
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState<'created' | 'active' | 'finished' | null>(null);
  const [joining, setJoining] = useState(false);
  const [roomRole, setRoomRole] = useState<'owner' | 'speaker' | 'viewer' | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  // This is deliberately opt-in so normal production sessions do not expose
  // media streams or pay the cost of browser diagnostics instrumentation.
  const diagnosticsParam = new URLSearchParams(window.location.search).get('e2eDiagnostics');
  const diagnosticsEnabled = diagnosticsParam === '1' || diagnosticsParam === 'true';
  const diagnosticsWindow = window as DiagnosticsWindow;
  const updateDiagnostics = (peers: RemotePeer[], peerId = localPeerId) => {
    if (!diagnosticsEnabled) return;
    diagnosticsWindow.__studioDiagnostics = {
      localPeerId: peerId,
      localName: user?.name ?? null,
      peers,
    };
  };

  const sfuRef = useRef<SfuClient | null>(null);
  const joiningRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localStream;

  const { pending: screenPending, run: runScreen } = useAsyncAction();

  const stopLocalScreen = async () => {
    await sfuRef.current?.stopScreen();
    setLocalScreenStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  };

  const leave = async () => {
    await stopLocalScreen();
    sfuRef.current?.close();
    sfuRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemotePeers([]);
    if (diagnosticsEnabled) delete diagnosticsWindow.__studioDiagnostics;
    setLocalPeerId(null);
    setJoined(false);
    setJoinedRoom(null);
    setRoomName(null);
    setRoomStatus(null);
    setRoomRole(null);
    joiningRef.current = false;
    setJoining(false);
  };

  const join = async () => {
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
      const { joinToken, room: joinedRoom, sfuUrl, role } = await joinRoom(room);
      setRoomRole(role);
      setRoomName(joinedRoom.name);
      setRoomStatus(joinedRoom.status);
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

      const sfu = new SfuClient({
        onPeersChanged: (peers) => {
          const nextPeers = [...peers];
          setRemotePeers(nextPeers);
          updateDiagnostics(nextPeers);
        },
      });
      sfuRef.current = sfu;
      await sfu.join(joinedRoom.slug, user.name, 'speaker', joinToken, sfuUrl);
      await sfu.publish(stream);
      setLocalPeerId(sfu.peerId);
      setJoinedRoom(joinedRoom.slug);
      setJoined(true);
      setJoining(false);
    } catch (err) {
      sfuRef.current?.close();
      sfuRef.current = null;
      joiningRef.current = false;
      setJoining(false);
      if (String(err).includes('401') || String(err).toLowerCase().includes('unauthorized')) {
        clearSession();
        onUnauthorized();
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stopScreenShare = () => {
    void runScreen(async () => {
      setError('');
      await stopLocalScreen();
    });
  };

  const toggleScreenShare = () => {
    if (localScreenStream) return;
    void runScreen(async () => {
      setError('');
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
        track.contentHint = 'detail';
        try {
          const constraints: MediaTrackConstraints & { resizeMode: 'none' } = {
            resizeMode: 'none',
          };
          await track.applyConstraints(constraints);
        } catch {
          // resizeMode is not supported in every browser; keep native capture.
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
    });
  };

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) track.enabled = !track.enabled;
    setLocalStream((stream) => stream ? new MediaStream(stream.getTracks()) : stream);
  };

  const toggleMicrophone = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = !track.enabled;
    setLocalStream((stream) => stream ? new MediaStream(stream.getTracks()) : stream);
  };

  const screenLabel = screenPending ? 'Starting share…' : 'Share screen';

  return {
    joined,
    joinedRoom,
    roomName,
    roomStatus,
    joining,
    roomRole,
    localPeerId,
    localStream,
    localScreenStream,
    remotePeers,
    join,
    leave,
    toggleScreenShare,
    stopScreenShare,
    screenPending,
    screenLabel,
    toggleCamera,
    toggleMicrophone,
  };
}
