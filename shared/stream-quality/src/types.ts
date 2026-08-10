export type StreamResolution = '1080p';
export type RecorderVideoCodec = 'h264' | 'vp9' | 'vp8';

export interface StreamProfile {
  width: number;
  height: number;
  fps: number;
  /** WebRTC publish cap per video track (camera / screen). */
  ingestVideoBps: number;
  /** WebRTC publish cap for mic audio. */
  ingestAudioBps: number;
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

export interface RecorderFormat {
  mimeType: string;
  codec: RecorderVideoCodec;
}

export interface PickRecorderFormatOptions {
  /** When true, only H.264 is acceptable (required for RTMP video copy). */
  requireH264?: boolean;
}
