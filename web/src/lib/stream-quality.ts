export type StreamResolution = '720p' | '1080p';
export type RecorderVideoCodec = 'h264' | 'vp9' | 'vp8';

export interface StreamProfile {
  width: number;
  height: number;
  fps: number;
  recorderVideoBps: number;
  recorderAudioBps: number;
}

export interface RecorderFormat {
  mimeType: string;
  codec: RecorderVideoCodec;
}

/** Keep recorder bitrates in sync with server/src/recordings/stream-quality.ts. */
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

/**
 * Prefer H.264 when Chrome can MediaRecord it — then ffmpeg can copy video to
 * RTMP and only transcode Opus → AAC (avoids the dirty VP9→H.264 hop).
 */
export function pickRecorderFormat(): RecorderFormat {
  const candidates: RecorderFormat[] = [
    { mimeType: 'video/webm;codecs=h264,opus', codec: 'h264' },
    { mimeType: 'video/webm;codecs=avc1,opus', codec: 'h264' },
    { mimeType: 'video/webm;codecs=vp9,opus', codec: 'vp9' },
    { mimeType: 'video/webm;codecs=vp8,opus', codec: 'vp8' },
  ];
  const supported = candidates.find(
    (c) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType),
  );
  return supported ?? { mimeType: 'video/webm;codecs=vp8,opus', codec: 'vp8' };
}
