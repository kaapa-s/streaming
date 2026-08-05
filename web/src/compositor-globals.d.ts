/// <reference types="vite/client" />

export {};

declare global {
  var __startRecording: (() => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
  interface Window {
    __startRecording?: () => Promise<void>;
    __stopRecording?: () => Promise<void>;
  }
}
