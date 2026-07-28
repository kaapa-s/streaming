export type StreamResolution = '720p' | '1080p';

export interface StreamProfile {
  width: number;
  height: number;
  fps: number;
  recorderVideoBps: number;
  recorderAudioBps: number;
}

/** Keep in sync with server/src/recordings/stream-quality.ts (recorder side). */
export const STREAM_PROFILES: Record<StreamResolution, StreamProfile> = {
  '720p': {
    width: 1280,
    height: 720,
    fps: 30,
    recorderVideoBps: 8_000_000,
    recorderAudioBps: 192_000,
  },
  '1080p': {
    width: 1920,
    height: 1080,
    fps: 30,
    recorderVideoBps: 14_000_000,
    recorderAudioBps: 192_000,
  },
};

export function parseResolution(value: string | null): StreamResolution {
  return value === '1080p' ? '1080p' : '720p';
}

/** Prefer VP9 over VP8 when Chrome supports it — better intermediate for the RTMP re-encode. */
export function pickRecorderMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];
  return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
    ?? 'video/webm;codecs=vp8,opus';
}
