import { useState } from 'react';
import type { StudioValue } from '../studio/studioHandle';
import type { PlatformProvider } from '../lib/platforms';
import { useLiveComments } from './useLiveComments';
import { usePlatformConnections } from './usePlatformConnections';
import { useProgramPreview } from './useProgramPreview';
import { useRecordingControls } from './useRecordingControls';
import { useRemoteAudio } from './useRemoteAudio';
import { useStudioAuth } from './useStudioAuth';
import { useStudioLayout } from './useStudioLayout';
import { useStudioSession } from './useStudioSession';

export function useStudioController(room: string): StudioValue {
  const [error, setError] = useState('');
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
  useRemoteAudio(session.joined, session.remotePeers);
  const recording = useRecordingControls(room, setError, {
    joined: session.joined,
    isOwner,
  });
  // Non-owners cannot start/stop sharing; they mirror the room's sharing state so
  // "Host is recording/live" is visible to everyone in the studio.
  const sharedSharing = studioLayout.sharing;
  const roomRecording = isOwner ? recording.recording : !!sharedSharing?.active;
  const roomLive = isOwner ? recording.live : !!sharedSharing?.live;
  const roomLiveDestinations = isOwner
    ? recording.liveDestinations
    : ((sharedSharing?.destinations ?? []) as PlatformProvider[]);
  const platforms = usePlatformConnections(Boolean(auth.user), setError);
  const liveToYoutube = roomLive && roomLiveDestinations.includes('youtube');
  // Comments are a room-participant surface: authenticated members only, never
  // unauthenticated guests.
  const canComment = Boolean(auth.user) && session.joined;
  const comments = useLiveComments({
    room,
    live: liveToYoutube,
    enabled: canComment,
    setError,
    setPreviewOverlay,
  });

  return {
    room,
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
    joinedRoom: session.joinedRoom,
    roomName: session.roomName,
    roomStatus: session.roomStatus,
    joining: session.joining,
    join: session.join,
    joinWithAdmission: session.joinWithAdmission,
    leave: async () => {
      recording.resetUi();
      await session.leave();
    },
    roomRole: session.roomRole,
    localPeerId: session.localPeerId,
    localStream: session.localStream,
    localScreenStream: session.localScreenStream,
    remotePeers: session.remotePeers,
    toggleScreenShare: session.toggleScreenShare,
    stopScreenShare: session.stopScreenShare,
    toggleCamera: session.toggleCamera,
    toggleMicrophone: session.toggleMicrophone,
    screenPending: session.screenPending,
    screenLabel: session.screenLabel,
    cameraPreset: studioLayout.layout.cameraPreset,
    featuredId: studioLayout.layout.featuredId,
    sceneScreenIds: studioLayout.layout.sceneScreenIds,
    setCameraPreset: studioLayout.setCameraPreset,
    setFeatured: studioLayout.setFeatured,
    toggleSceneScreen: studioLayout.toggleSceneScreen,
    previewRef,
    recording: roomRecording,
    live: roomLive,
    liveDestinations: roomLiveDestinations,
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
    participants: studioLayout.participants,
    participantPendingId: studioLayout.participantPendingId,
    participantError: studioLayout.participantError,
    setParticipantScene: studioLayout.setParticipantScene,
    kickParticipant: studioLayout.kickParticipant,
    platforms: platforms.status,
    platformPending: platforms.pendingProvider,
    connectPlatform: (provider) => {
      void platforms.connect(provider);
    },
    disconnectPlatform: (provider) => {
      void platforms.disconnect(provider);
    },
    comments: comments.comments,
    commentProvider: comments.provider,
    commentCapabilities: comments.capabilities,
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
    removeComment: (c) => {
      void comments.removeComment(c);
    },
    banCommentAuthor: (c, durationSeconds) => {
      void comments.banCommentAuthor(c, durationSeconds);
    },
    commentActionPendingId: comments.actionPendingId,
    clearOverlay: () => {
      void comments.clearOverlay();
    },
    pinnedCommentId: comments.pinnedId,
    canComment,
    isRoomOwner: isOwner,
  };
}
