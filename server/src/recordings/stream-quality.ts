export type StreamResolution = '720p' | '1080p';

export interface StreamProfile {
  width: number;
  height: number;
  fps: number;
  /** MediaRecorder intermediate target (keep above RTMP so the re-encode has headroom). */
  recorderVideoBps: number;
  recorderAudioBps: number;
  /** ffmpeg → YouTube H.264 */
  rtmpVideoBitrate: string;
  rtmpMaxrate: string;
  rtmpBufsize: string;
  rtmpAudioBitrate: string;
  /** libx264 preset: slower = better quality at same bitrate */
  ffmpegPreset: string;
}

/**
 * Targets the high end of YouTube's live recommendations for 30fps, with a
 * stronger intermediate encode so the unavoidable VP8/VP9 → H.264 hop hurts less.
 * @see https://support.google.com/youtube/answer/2853702
 */
export const STREAM_PROFILES: Record<StreamResolution, StreamProfile> = {
  '720p': {
    width: 1280,
    height: 720,
    fps: 30,
    recorderVideoBps: 8_000_000,
    recorderAudioBps: 192_000,
    rtmpVideoBitrate: '4500k',
    rtmpMaxrate: '5000k',
    rtmpBufsize: '10000k',
    rtmpAudioBitrate: '160k',
    ffmpegPreset: 'fast',
  },
  '1080p': {
    width: 1920,
    height: 1080,
    fps: 30,
    recorderVideoBps: 14_000_000,
    recorderAudioBps: 192_000,
    rtmpVideoBitrate: '6000k',
    rtmpMaxrate: '6500k',
    rtmpBufsize: '12000k',
    rtmpAudioBitrate: '192k',
    ffmpegPreset: 'fast',
  },
};

export function parseResolution(value: unknown): StreamResolution {
  return value === '1080p' ? '1080p' : '720p';
}
