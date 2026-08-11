import { useState } from 'react';
import type { StudioValue } from '../studio/studioHandle';
import { useLiveComments } from './useLiveComments';
import { useProgramPreview } from './useProgramPreview';
import { useRecordingControls } from './useRecordingControls';
import { useRemoteAudio } from './useRemoteAudio';
import { useStudioAuth } from './useStudioAuth';
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
  const { previewRef, setPreviewOverlay } = useProgramPreview({
    joined: session.joined,
    localStream: session.localStream,
    localScreenStream: session.localScreenStream,
    remotePeers: session.remotePeers,
    name,
  });
  useRemoteAudio(session.joined, session.remotePeers);
  const recording = useRecordingControls(room, setError);
  const isOwner = session.roomRole === 'owner';
  const comments = useLiveComments({
    room,
    live: recording.live,
    isOwner,
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
    onLogout: () => auth.onLogout(session.leave),
    joined: session.joined,
    joining: session.joining,
    join: session.join,
    leave: session.leave,
    roomRole: session.roomRole,
    localStream: session.localStream,
    localScreenStream: session.localScreenStream,
    remotePeers: session.remotePeers,
    toggleScreenShare: session.toggleScreenShare,
    screenPending: session.screenPending,
    screenLabel: session.screenLabel,
    previewRef,
    recording: recording.recording,
    live: recording.live,
    recordingInfo: recording.recordingInfo,
    finishedRecording: recording.finishedRecording,
    setFinishedRecording: recording.setFinishedRecording,
    rtmpUrl: recording.rtmpUrl,
    setRtmpUrl: recording.setRtmpUrl,
    recordingPending: recording.recordingPending,
    toggleRecording: recording.toggleRecording,
    actionLabel: recording.actionLabel,
    streamControlsLocked: recording.streamControlsLocked,
    youtubeConnected: comments.youtubeStatus.connected,
    youtubeAccountLabel: comments.youtubeStatus.accountLabel,
    youtubePending: comments.youtubePending,
    connectYoutube: () => {
      void comments.connectYoutube();
    },
    disconnectYoutube: () => {
      void comments.disconnectYoutube();
    },
    comments: comments.comments,
    commentsSessionActive: comments.sessionActive,
    commentsSessionTitle: comments.sessionTitle,
    commentsSessionPending: comments.sessionPending,
    commentsVideoUrl: comments.videoUrl,
    setCommentsVideoUrl: comments.setVideoUrl,
    startCommentsSession: () => {
      void comments.startSession();
    },
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
