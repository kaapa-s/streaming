export {};

declare global {
  var __startRecording: ((opts?: { requireH264?: boolean }) => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
  var __setOverlay:
    | ((overlay: { author: string; text: string; until?: number }) => void)
    | undefined;
  var __clearOverlay: (() => void) | undefined;
}
