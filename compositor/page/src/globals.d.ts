export {};

export interface StartRecordingOptions {
  requireH264?: boolean;
}

declare global {
  var __startRecording: ((opts?: StartRecordingOptions) => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
  interface Window {
    __startRecording?: (opts?: StartRecordingOptions) => Promise<void>;
    __stopRecording?: () => Promise<void>;
  }
}
