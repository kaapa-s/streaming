export {};

export interface StartRecordingOptions {
  requireH264?: boolean;
}

export interface CommentOverlayPayload {
  author: string;
  text: string;
  until?: number;
}

export interface LayoutStatePayload {
  cameraPreset: 'focus' | 'pip-left' | 'pip-right' | 'grid';
  featuredId: string | null;
  sceneScreenIds: string[];
}

export interface LayoutSnapshotPayload {
  cameraPreset: LayoutStatePayload['cameraPreset'];
  featuredId: string | null;
  sceneScreenIds: string[];
  effective: string;
  sources: string[];
}

declare global {
  var __startRecording: ((opts?: StartRecordingOptions) => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
  var __setOverlay: ((overlay: CommentOverlayPayload) => void) | undefined;
  var __clearOverlay: (() => void) | undefined;
  var __setLayout: ((state: LayoutStatePayload) => void) | undefined;
  var __getLayoutSnapshot: (() => LayoutSnapshotPayload) | undefined;
  interface Window {
    __startRecording?: (opts?: StartRecordingOptions) => Promise<void>;
    __stopRecording?: () => Promise<void>;
    __setOverlay?: (overlay: CommentOverlayPayload) => void;
    __clearOverlay?: () => void;
    __setLayout?: (state: LayoutStatePayload) => void;
    __getLayoutSnapshot?: () => LayoutSnapshotPayload;
  }
}
