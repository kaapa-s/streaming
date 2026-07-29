/// <reference types="vite/client" />

export {};

declare global {
  /** Exposed by the compositor page so Puppeteer can stop MediaRecorder cleanly. */
  var __stopRecording: (() => Promise<void>) | undefined;

  interface Window {
    __stopRecording?: () => Promise<void>;
  }
}
