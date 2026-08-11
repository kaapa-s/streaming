export {};

export interface StartRecordingOptions {
  requireH264?: boolean;
}

export interface CommentOverlayPayload {
  author: string;
  text: string;
  until?: number;
}

declare global {
  var __startRecording: ((opts?: StartRecordingOptions) => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
  var __setOverlay: ((overlay: CommentOverlayPayload) => void) | undefined;
  var __clearOverlay: (() => void) | undefined;
  interface Window {
    __startRecording?: (opts?: StartRecordingOptions) => Promise<void>;
    __stopRecording?: () => Promise<void>;
    __setOverlay?: (overlay: CommentOverlayPayload) => void;
    __clearOverlay?: () => void;
  }
}
