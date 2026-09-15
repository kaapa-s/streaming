import { useEffect, useRef, useState } from 'react';
import { SfuClient, type RemotePeer } from '@streaming/sfu-client';
import { clearSession, type AuthUser } from '../lib/auth';
import { joinRoom, removeMember } from '../lib/rooms';
import { useAsyncAction } from './useAsyncAction';

type UseStudioSessionArgs = {
  user: AuthUser | null;
  /** null on the auth shell, where there is no room to join. */
  room: string | null;
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
  const [joining, setJoining] = useState(false);
  const [roomRole, setRoomRole] = useState<'owner' | 'speaker' | 'viewer' | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [localAudioTrackIds, setLocalAudioTrackIds] = useState<string[]>([]);
  const [roomTitle, setRoomTitle] = useState('');
  const [removedFromRoom, setRemovedFromRoom] = useState<string | null>(null);

  const sfuRef = useRef<SfuClient | null>(null);
  /** Users the owner has removed, so a reconnecting peer gets kicked again. */
  const removedUserIds = useRef(new Set<string>());
  const joiningRef = useRef(false);
  /** Full getUserMedia (cam+mic) — publish only. Never attach this to a media element. */
  const captureRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localStream;
  localScreenStreamRef.current = localScreenStream;

  const { pending: screenPending, run: runScreen } = useAsyncAction();

  const stopLocalScreen = async () => {
    await sfuRef.current?.stopScreen();
    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localScreenStreamRef.current = null;
    setLocalScreenStream(null);
  };

  const stopPublishing = () => {
    sfuRef.current?.close();
    sfuRef.current = null;
    captureRef.current?.getTracks().forEach((t) => t.stop());
    captureRef.current = null;
    localStreamRef.current = null;
    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localScreenStreamRef.current = null;
    setLocalAudioTrackIds([]);
  };

  const leave = async () => {
    await sfuRef.current?.stopScreen();
    stopPublishing();
    setLocalScreenStream(null);
    setLocalStream(null);
    setRemotePeers([]);
    setLocalPeerId(null);
    setJoined(false);
    setRoomRole(null);
    removedUserIds.current.clear();
    joiningRef.current = false;
    setJoining(false);
  };

  // HMR / layout remount used to leave the SFU publisher alive. The next join
  // then heard that zombie as a "remote" mic (feedback: you hear yourself type).
  useEffect(() => {
    return () => {
      sfuRef.current?.close();
      sfuRef.current = null;
      captureRef.current?.getTracks().forEach((t) => t.stop());
      captureRef.current = null;
      localStreamRef.current = null;
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current = null;
    };
  }, []);

  const join = async () => {
    if (!user || !room || joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera/mic unavailable: this page must be served over HTTPS (or localhost). Open the https:// URL Vite prints.',
        );
      }
      // Camera first, then the join: the join token is short-lived, and someone
      // sitting on the permission prompt would otherwise expire it before the
      // SFU ever sees it. It also avoids creating a membership row for someone
      // who then denies the camera.
      const capture = await navigator.mediaDevices.getUserMedia({
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
      captureRef.current = capture;
      // Preview/tiles/compositor must never see mic tracks. Binding the full
      // getUserMedia stream to <video> (even muted) leaks your voice to the
      // speakers — built-in mic+speakers then howl. Publish `capture` only.
      const preview = new MediaStream(capture.getVideoTracks());
      localStreamRef.current = preview;
      setLocalStream(preview);
      setLocalAudioTrackIds(capture.getAudioTracks().map((t) => t.id));

      const { joinToken, room: joinedRoom, sfuUrl, role } = await joinRoom(room);
      setRoomRole(role);
      setRoomTitle(joinedRoom.title);

      const sfu = new SfuClient({
        onPeersChanged: (peers) => setRemotePeers([...peers]),
        onKicked: (reason) => {
          setRemovedFromRoom(reason);
          void leave();
        },
      });
      sfuRef.current = sfu;
      await sfu.join(joinedRoom.slug, user.name, 'speaker', joinToken, sfuUrl, user.id);
      await sfu.publish(capture);
      setLocalPeerId(sfu.peerId);
      setJoined(true);
      setJoining(false);
    } catch (err) {
      stopPublishing();
      setLocalStream(null);
      joiningRef.current = false;
      setJoining(false);
      if (String(err).includes('401') || String(err).toLowerCase().includes('unauthorized')) {
        clearSession();
        onUnauthorized();
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Remove someone from the room. The API call is the durable half and must
   * land first — the signaling kick only drops the socket, so doing it first
   * would let the target reconnect with a fresh token before the row is marked.
   */
  const kickUser = async (userId: string) => {
    if (!room || !userId) return;
    setError('');
    try {
      await removeMember(room, userId);
      removedUserIds.current.add(userId);
      await sfuRef.current?.kick(userId).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Closes the room at the media layer. The API teardown is a separate call. */
  const closeRoomMedia = async () => {
    await sfuRef.current?.closeRoom().catch(() => undefined);
  };

  // If a removed user reconnects before their ban expires — or the socket kick
  // failed outright — drop them again as soon as they reappear.
  useEffect(() => {
    if (!joined || removedUserIds.current.size === 0) return;
    for (const peer of remotePeers) {
      const userId = peer.userId;
      if (userId && removedUserIds.current.has(userId)) {
        void sfuRef.current?.kick(userId).catch(() => undefined);
      }
    }
  }, [joined, remotePeers]);

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
        localScreenStreamRef.current = screen;
        setLocalScreenStream(screen);
      } catch (err) {
        // User cancelled the picker — not an error worth showing.
        if (err instanceof DOMException && err.name === 'NotAllowedError') return;
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const screenLabel = screenPending ? 'Starting share…' : 'Share screen';

  return {
    joined,
    joining,
    roomRole,
    roomTitle,
    removedFromRoom,
    clearRemovedFromRoom: () => setRemovedFromRoom(null),
    kickUser,
    closeRoomMedia,
    localPeerId,
    localStream,
    localScreenStream,
    localAudioTrackIds,
    remotePeers,
    join,
    leave,
    toggleScreenShare,
    stopScreenShare,
    screenPending,
    screenLabel,
  };
}
