export {};

declare global {
  var __startRecording: (() => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
}
