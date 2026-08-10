export {};

declare global {
  var __startRecording: ((opts?: { requireH264?: boolean }) => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
}
