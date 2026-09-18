import type { AuthMode } from '../lib/authMode';
import type { FinishedRecording } from '../components/studio/RecordingFinishedModal';
import type { LiveComment } from '../hooks/useLiveComments';
import type { RemotePeer } from '@streaming/sfu-client';
import type { AuthUser } from '../lib/auth';
import type { CameraPreset } from '@streaming/canvas-compositor';
import type { RoomParticipant } from '../lib/roomState';
import type {
  AllPlatformStatus,
  OutboundDestination,
  PlatformProvider,
} from '../lib/platforms';

export type StudioValue = {
  room: string;
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
  joinedRoom: string | null;
  roomName: string | null;
  roomStatus: 'created' | 'active' | 'finished' | null;
  joining: boolean;
  join: () => Promise<void>;
  joinWithAdmission: (admission: { room: { slug: string }; joinToken: string; sfuUrl?: string; role: 'owner' | 'speaker' | 'viewer' }, displayName: string) => Promise<void>;
  leave: () => Promise<void>;
  roomRole: 'owner' | 'speaker' | 'viewer' | null;
  localPeerId: string | null;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
  toggleScreenShare: () => void;
  stopScreenShare: () => void;
  toggleCamera: () => void;
  toggleMicrophone: () => void;
  screenPending: boolean;
  screenLabel: string;
  cameraPreset: CameraPreset;
  featuredId: string | null;
  sceneScreenIds: string[];
  setCameraPreset: (preset: CameraPreset) => void;
  setFeatured: (sourceId: string) => void;
  toggleSceneScreen: (sourceId: string) => void;
  previewRef: (node: HTMLDivElement | null) => void;
  recording: boolean;
  live: boolean;
  liveDestinations: PlatformProvider[];
  recordingInfo: string;
  finishedRecording: FinishedRecording | null;
  setFinishedRecording: (value: FinishedRecording | null) => void;
  streamKeys: Record<PlatformProvider, string>;
  setStreamKey: (platform: PlatformProvider, value: string) => void;
  recordingPending: boolean;
  startRecording: () => void;
  goLive: (destinations: OutboundDestination[]) => void;
  stopRecording: () => void;
  toggleRecording: () => void;
  streamControlsLocked: boolean;
  participants: RoomParticipant[];
  participantPendingId: string | null;
  participantError: string;
  setParticipantScene: (memberId: string, inScene: boolean) => void;
  kickParticipant: (memberId: string) => void;
  platforms: AllPlatformStatus;
  platformPending: PlatformProvider | null;
  connectPlatform: (provider: PlatformProvider) => void;
  disconnectPlatform: (provider: PlatformProvider) => void;
  comments: LiveComment[];
  commentsSessionActive: boolean;
  commentsSessionTitle?: string;
  commentsSessionPending: boolean;
  commentsBindFailed: boolean;
  replyText: string;
  setReplyText: (value: string) => void;
  replyPending: boolean;
  sendReply: () => void;
  pinComment: (comment: LiveComment) => void;
  clearOverlay: () => void;
  pinnedCommentId: string | null;
  isRoomOwner: boolean;
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
