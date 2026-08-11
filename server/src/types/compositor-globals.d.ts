export {};

declare global {
  /** Exposed by the compositor page so Puppeteer can control MediaRecorder / overlays. */
  var __startRecording: (() => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
  var __setOverlay:
    | ((overlay: { author: string; text: string; until?: number }) => void)
    | undefined;
  var __clearOverlay: (() => void) | undefined;
}
