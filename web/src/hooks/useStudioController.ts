import { useState } from 'react';
import { endRoom } from '../lib/rooms';
import type { StudioValue } from '../studio/studioHandle';
import { useLiveComments } from './useLiveComments';
import { usePlatformConnections } from './usePlatformConnections';
import { useProgramPreview } from './useProgramPreview';
import { useRecordingControls } from './useRecordingControls';
import { useRemoteAudio } from './useRemoteAudio';
import { useStudioAuth } from './useStudioAuth';
import { useStudioLayout } from './useStudioLayout';
import { useStudioSession } from './useStudioSession';

/**
 * `room` is null on the auth shell (login / new stream / settings), where there
 * is nothing to join yet. The room-scoped hooks all no-op in that state, so the
 * shell still gets auth and platform connections from one controller.
 */
export function useStudioController(room: string | null): StudioValue {
  const [error, setError] = useState('');
  const [endPending, setEndPending] = useState(false);
  const auth = useStudioAuth(setError);
  const session = useStudioSession({
    user: auth.user,
    room,
    setError,
    onUnauthorized: auth.clearUser,
  });
  const name = auth.user?.name ?? '';
  const isOwner = session.roomRole === 'owner';
  const studioLayout = useStudioLayout({
    room,
    isOwner,
    joined: session.joined,
    localPeerId: session.localPeerId,
    localStream: session.localStream,
    localScreenStream: session.localScreenStream,
    remotePeers: session.remotePeers,
  });
  const { previewRef, setPreviewOverlay } = useProgramPreview({
    joined: session.joined,
    localPeerId: session.localPeerId,
    localStream: session.localStream,
    localScreenStream: session.localScreenStream,
    remotePeers: session.remotePeers,
    name,
    layout: studioLayout.layout,
  });
  // Speakers play other people's mics only. Never pass localStream (even
  // muted <video> leaks mic). Preview mixAudio stays off. Same-account
  // extra laptops are still you — they must not play here.
  useRemoteAudio(session.joined, session.remotePeers, {
    localPeerId: session.localPeerId,
    localUserId: auth.user?.id ?? null,
    localAudioTrackIds: session.localAudioTrackIds,
  });
  const recording = useRecordingControls(room, setError);
  const platforms = usePlatformConnections(Boolean(auth.user), setError);
  const liveToYoutube = recording.live && recording.liveDestinations.includes('youtube');
  const comments = useLiveComments({
    room,
    live: liveToYoutube,
    isOwner,
    youtubeConnected: platforms.status.youtube.connected,
    setError,
    setPreviewOverlay,
  });

  return {
    error,
    user: auth.user,
    authMode: auth.authMode,
    setAuthMode: auth.setAuthMode,
    email: auth.email,
    setEmail: auth.setEmail,
    password: auth.password,
    setPassword: auth.setPassword,
    signupPassword: auth.signupPassword,
    setSignupPassword: auth.setSignupPassword,
    displayName: auth.displayName,
    setDisplayName: auth.setDisplayName,
    authPending: auth.authPending,
    logoutPending: auth.logoutPending,
    authLabel: auth.authLabel,
    onAuth: auth.onAuth,
    onLogout: () =>
      auth.onLogout(async () => {
        recording.resetUi();
        await session.leave();
      }),
    joined: session.joined,
    joining: session.joining,
    join: session.join,
    leave: async () => {
      recording.resetUi();
      await session.leave();
    },
    roomRole: session.roomRole,
    roomSlug: room,
    roomTitle: session.roomTitle,
    removedFromRoom: session.removedFromRoom,
    clearRemovedFromRoom: session.clearRemovedFromRoom,
    kickUser: (userId) => {
      void session.kickUser(userId);
    },
    endPending,
    // Deliberately does NOT call session.leave(): flipping `joined` here would
    // trip the /live route guard into redirecting to the pre-join screen, racing
    // the caller's own navigation. The caller navigates away instead, and
    // unmounting the room layout runs useStudioSession's cleanup, which closes
    // the SFU client and stops the camera/mic tracks. resetUi must still run
    // first, or useBlocker would prompt about an "active session" on the way out.
    endStream: async () => {
      if (!room || endPending) return;
      setEndPending(true);
      try {
        // API first: it closes the room, stops any recording and frees the
        // compositor slot. The signaling close then drops everyone still on it.
        await endRoom(room);
        await session.closeRoomMedia();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setEndPending(false);
        recording.resetUi();
      }
    },
    localPeerId: session.localPeerId,
    localStream: session.localStream,
    localScreenStream: session.localScreenStream,
    remotePeers: session.remotePeers,
    toggleScreenShare: session.toggleScreenShare,
    stopScreenShare: session.stopScreenShare,
    screenPending: session.screenPending,
    screenLabel: session.screenLabel,
    cameraPreset: studioLayout.layout.cameraPreset,
    featuredId: studioLayout.layout.featuredId,
    sceneScreenIds: studioLayout.layout.sceneScreenIds,
    setCameraPreset: studioLayout.setCameraPreset,
    setFeatured: studioLayout.setFeatured,
    toggleSceneScreen: studioLayout.toggleSceneScreen,
    previewRef,
    recording: recording.recording,
    live: recording.live,
    liveDestinations: recording.liveDestinations,
    recordingInfo: recording.recordingInfo,
    finishedRecording: recording.finishedRecording,
    setFinishedRecording: recording.setFinishedRecording,
    streamKeys: recording.streamKeys,
    setStreamKey: recording.setStreamKey,
    recordingPending: recording.recordingPending,
    startRecording: recording.startRecording,
    goLive: recording.goLive,
    stopRecording: recording.stopRecording,
    toggleRecording: recording.toggleRecording,
    streamControlsLocked: recording.streamControlsLocked,
    platforms: platforms.status,
    platformPending: platforms.pendingProvider,
    connectPlatform: (provider) => {
      void platforms.connect(provider);
    },
    disconnectPlatform: (provider) => {
      void platforms.disconnect(provider);
    },
    comments: comments.comments,
    commentsSessionActive: comments.sessionActive,
    commentsSessionTitle: comments.sessionTitle,
    commentsSessionPending: comments.sessionPending,
    commentsBindFailed: comments.bindFailed,
    replyText: comments.replyText,
    setReplyText: comments.setReplyText,
    replyPending: comments.replyPending,
    sendReply: () => {
      void comments.sendReply();
    },
    pinComment: (c) => {
      void comments.pinComment(c);
    },
    clearOverlay: () => {
      void comments.clearOverlay();
    },
    pinnedCommentId: comments.pinnedId,
    isRoomOwner: isOwner,
  };
}
