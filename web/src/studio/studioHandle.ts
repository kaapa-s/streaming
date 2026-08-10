import type { AuthMode } from '../components/studio/AuthLobby';
import type { FinishedRecording } from '../components/studio/RecordingFinishedModal';
import type { StreamResolution } from '@streaming/stream-quality';
import type { RemotePeer } from '@streaming/sfu-client';
import type { AuthUser } from '../lib/auth';

export type StudioValue = {
  error: string;
  user: AuthUser | null;
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  signupPassword: string;
  setSignupPassword: (value: string) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  authPending: boolean;
  logoutPending: boolean;
  authLabel: string;
  onAuth: (e: React.FormEvent) => void;
  onLogout: () => void;
  joined: boolean;
  joining: boolean;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
  toggleScreenShare: () => void;
  screenPending: boolean;
  screenLabel: string;
  previewRef: (node: HTMLDivElement | null) => void;
  recording: boolean;
  live: boolean;
  recordingInfo: string;
  finishedRecording: FinishedRecording | null;
  setFinishedRecording: (value: FinishedRecording | null) => void;
  rtmpUrl: string;
  setRtmpUrl: (value: string) => void;
  resolution: StreamResolution;
  setResolution: (value: StreamResolution) => void;
  recordingPending: boolean;
  toggleRecording: () => void;
  actionLabel: string;
  streamControlsLocked: boolean;
};

export type StudioHandle = {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => StudioValue;
  tryGet: () => StudioValue | undefined;
  publish: (value: StudioValue) => void;
  notify: () => void;
};

export function createStudioHandle(): StudioHandle {
  let snapshot: StudioValue | undefined;
  const listeners = new Set<() => void>();

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      if (snapshot === undefined) {
        throw new Error('Studio not initialized');
      }
      return snapshot;
    },
    tryGet() {
      return snapshot;
    },
    publish(value) {
      snapshot = value;
    },
    notify() {
      listeners.forEach((listener) => listener());
    },
  };
}
