import { useState } from 'react';
import { useProgramPreview } from './useProgramPreview';
import { useRecordingControls } from './useRecordingControls';
import { useRemoteAudio } from './useRemoteAudio';
import { useStudioAuth } from './useStudioAuth';
import { useStudioSession } from './useStudioSession';
import type { StudioValue } from '../studio/studioHandle';

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
  const { previewRef } = useProgramPreview({
    joined: session.joined,
    localStream: session.localStream,
    localScreenStream: session.localScreenStream,
    remotePeers: session.remotePeers,
    name,
  });
  useRemoteAudio(session.joined, session.remotePeers);
  const recording = useRecordingControls(room, setError);

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
  };
}
