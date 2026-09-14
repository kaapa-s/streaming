export {};

declare global {
  var __startRecording: ((opts?: { requireH264?: boolean }) => Promise<void>) | undefined;
  var __stopRecording: (() => Promise<void>) | undefined;
  var __setOverlay:
    | ((overlay: { author: string; text: string; until?: number }) => void)
    | undefined;
  var __clearOverlay: (() => void) | undefined;
  var __setLayout:
    | ((state: {
        cameraPreset: 'focus' | 'pip-left' | 'pip-right' | 'grid';
        featuredId: string | null;
        sceneScreenIds: string[];
      }) => void)
    | undefined;
  var __getLayoutSnapshot:
    | (() => {
        cameraPreset: string;
        featuredId: string | null;
        sceneScreenIds: string[];
        effective: string;
        sources: string[];
      })
    | undefined;
}
