import type { RecorderFormat } from './types';

/** Preferred MediaRecorder formats — H.264 allows ffmpeg `-c:v copy` to RTMP. */
export const H264_RECORDER_FORMATS: readonly RecorderFormat[] = [
  { mimeType: 'video/webm;codecs=h264,opus', codec: 'h264' },
  { mimeType: 'video/webm;codecs=avc1,opus', codec: 'h264' },
];

/** Fallback when H.264 MediaRecorder is unavailable (archive-only; RTMP must re-encode). */
export const FALLBACK_RECORDER_FORMATS: readonly RecorderFormat[] = [
  { mimeType: 'video/webm;codecs=vp9,opus', codec: 'vp9' },
  { mimeType: 'video/webm;codecs=vp8,opus', codec: 'vp8' },
];

export const DEFAULT_RECORDER_FORMAT: RecorderFormat = {
  mimeType: 'video/webm;codecs=vp8,opus',
  codec: 'vp8',
};
