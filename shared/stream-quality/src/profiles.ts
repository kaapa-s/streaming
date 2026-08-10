import type { StreamProfile, StreamResolution } from './types';

/**
 * 1080p60 profile — high end of YouTube live guidance with headroom for archival
 * when the compositor cannot emit H.264 directly.
 * @see https://support.google.com/youtube/answer/2853702
 */
export const STREAM_PROFILES: Record<StreamResolution, StreamProfile> = {
  '1080p': {
    width: 1920,
    height: 1080,
    fps: 60,
    ingestVideoBps: 10_000_000,
    ingestAudioBps: 192_000,
    recorderVideoBps: 25_000_000,
    recorderAudioBps: 256_000,
    rtmpVideoBitrate: '12000k',
    rtmpMaxrate: '13000k',
    rtmpBufsize: '24000k',
    rtmpAudioBitrate: '256k',
    ffmpegPreset: 'medium',
  },
};
