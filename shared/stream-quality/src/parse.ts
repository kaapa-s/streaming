import {
  DEFAULT_RECORDER_FORMAT,
  FALLBACK_RECORDER_FORMATS,
  H264_RECORDER_FORMATS,
} from './recorder-formats';
import type {
  PickRecorderFormatOptions,
  RecorderFormat,
  RecorderVideoCodec,
  StreamResolution,
} from './types';

/** Always 1080p — kept for API compatibility with callers that pass resolution. */
export function parseResolution(_value?: unknown): StreamResolution {
  return '1080p';
}

export function parseRecorderCodec(value: unknown): RecorderVideoCodec {
  if (value === 'h264' || value === 'vp9' || value === 'vp8') return value;
  return 'vp9';
}

function isSupported(mimeType: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType);
}

/**
 * Prefer H.264 when Chrome can MediaRecord it — then ffmpeg can copy video to
 * RTMP and only transcode Opus → AAC (avoids the dirty VP9→H.264 hop).
 */
export function pickRecorderFormat(options: PickRecorderFormatOptions = {}): RecorderFormat {
  const { requireH264 = false } = options;
  const candidates = requireH264
    ? H264_RECORDER_FORMATS
    : [...H264_RECORDER_FORMATS, ...FALLBACK_RECORDER_FORMATS];
  const supported = candidates.find((c) => isSupported(c.mimeType));
  if (supported) return supported;
  if (requireH264) {
    throw new Error(
      'H.264 MediaRecorder not supported — required for live RTMP (video copy path)',
    );
  }
  return DEFAULT_RECORDER_FORMAT;
}
