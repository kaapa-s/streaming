export type StreamResolution = '720p' | '1080p';
export type RecorderVideoCodec = 'h264' | 'vp9' | 'vp8';

export interface StreamProfile {
  width: number;
  height: number;
  fps: number;
  /** MediaRecorder intermediate target (keep above RTMP so the re-encode has headroom). */
  recorderVideoBps: number;
  recorderAudioBps: number;
  /** ffmpeg → YouTube H.264 (used when we must re-encode VP8/VP9). */
  rtmpVideoBitrate: string;
  rtmpMaxrate: string;
  rtmpBufsize: string;
  rtmpAudioBitrate: string;
  /** libx264 preset: slower = better quality at same bitrate */
  ffmpegPreset: string;
}

/**
 * High end of YouTube's live guidance for 30fps, with headroom for a second encode
 * when the compositor cannot emit H.264 directly.
 * @see https://support.google.com/youtube/answer/2853702
 */
export const STREAM_PROFILES: Record<StreamResolution, StreamProfile> = {
  '720p': {
    width: 1280,
    height: 720,
    fps: 30,
    recorderVideoBps: 8_000_000,
    recorderAudioBps: 192_000,
    rtmpVideoBitrate: '5500k',
    rtmpMaxrate: '6000k',
    rtmpBufsize: '12000k',
    rtmpAudioBitrate: '160k',
    ffmpegPreset: 'medium',
  },
  '1080p': {
    width: 1920,
    height: 1080,
    fps: 30,
    recorderVideoBps: 14_000_000,
    recorderAudioBps: 192_000,
    rtmpVideoBitrate: '8000k',
    rtmpMaxrate: '8500k',
    rtmpBufsize: '16000k',
    rtmpAudioBitrate: '192k',
    ffmpegPreset: 'medium',
  },
};

export function parseResolution(value: unknown): StreamResolution {
  return value === '1080p' ? '1080p' : '720p';
}

export function parseRecorderCodec(value: unknown): RecorderVideoCodec {
  if (value === 'h264' || value === 'vp9' || value === 'vp8') return value;
  return 'vp9';
}
