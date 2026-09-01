/**
 * One audio clock for the whole pipeline.
 *
 * WebRTC Opus, the compositor Web Audio mix, MediaRecorder, and ffmpeg AAC
 * must share this rate. A 44.1 kHz AudioContext against 48 kHz Opus is what
 * produced crackle (double resample + 0 dBFS clicks).
 */
export const AUDIO = {
  sampleRate: 48_000,
  channels: 2,
  /** Mix-bus headroom so summed peer mics do not hit 0 dBFS as single-sample clicks. */
  mixGain: 0.8,
  /** Stretch/squeeze Chrome MediaRecorder's millisecond WebM timestamps on the RTMP hop. */
  ffmpegResampleFilter: 'aresample=async=1:first_pts=0',
} as const;
