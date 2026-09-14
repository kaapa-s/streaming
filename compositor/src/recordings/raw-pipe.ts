export const RAW_VIDEO = 1;
export const RAW_AUDIO = 2;

export type RawKind = 'video' | 'audio';

/**
 * WebCodecs pixel format → ffmpeg rawvideo `-pix_fmt` and bytes per pixel.
 *
 * `VideoFrame.copyTo()` refuses an explicit non-RGB format, so the page cannot
 * force I420 — it copies whatever the frame already is and names it here. GPU
 * compositing commonly yields NV12 rather than I420, and the two are the same
 * size, so the format has to travel with the frame or ffmpeg decodes garbage.
 */
const VIDEO_FORMATS = {
  I420: { code: 1, pixFmt: 'yuv420p', bpp: 1.5 },
  NV12: { code: 2, pixFmt: 'nv12', bpp: 1.5 },
  I420A: { code: 3, pixFmt: 'yuva420p', bpp: 2.5 },
  I422: { code: 4, pixFmt: 'yuv422p', bpp: 2 },
  I444: { code: 5, pixFmt: 'yuv444p', bpp: 3 },
  RGBA: { code: 6, pixFmt: 'rgba', bpp: 4 },
  RGBX: { code: 7, pixFmt: 'rgb0', bpp: 4 },
  BGRA: { code: 8, pixFmt: 'bgra', bpp: 4 },
  BGRX: { code: 9, pixFmt: 'bgr0', bpp: 4 },
} as const;

export type VideoFormatName = keyof typeof VIDEO_FORMATS;

export interface VideoFormat {
  name: VideoFormatName;
  /** ffmpeg `-pix_fmt` for `-f rawvideo`. */
  pixFmt: string;
  bpp: number;
}

const BY_CODE = new Map<number, VideoFormat>(
  Object.entries(VIDEO_FORMATS).map(([name, spec]) => [
    spec.code,
    { name: name as VideoFormatName, pixFmt: spec.pixFmt, bpp: spec.bpp },
  ]),
);

/** Wire code for a WebCodecs format name, or undefined when unsupported. */
export function videoFormatCode(name: string): number | undefined {
  return VIDEO_FORMATS[name as VideoFormatName]?.code;
}

export function videoFormatByCode(code: number): VideoFormat | undefined {
  return BY_CODE.get(code);
}

export function frameSize(format: VideoFormat, width: number, height: number): number {
  return width * height * format.bpp;
}

export function i420FrameSize(width: number, height: number): number {
  return (width * height * 3) / 2;
}

export interface RawVideoPacket {
  kind: 'video';
  format: VideoFormat;
  payload: Buffer;
}

export interface RawAudioPacket {
  kind: 'audio';
  payload: Buffer;
}

export type RawPacket = RawVideoPacket | RawAudioPacket;

/**
 * Video frames are `[RAW_VIDEO][formatCode][payload]`; audio is
 * `[RAW_AUDIO][payload]`. An unknown format code is dropped rather than fed to
 * ffmpeg under the wrong `-pix_fmt`.
 */
export function parseRawPacket(buf: Buffer): RawPacket | undefined {
  if (buf.length < 2) return undefined;
  const kindByte = buf[0];
  if (kindByte === RAW_AUDIO) return { kind: 'audio', payload: buf.subarray(1) };
  if (kindByte !== RAW_VIDEO) return undefined;
  if (buf.length < 3) return undefined;
  const format = videoFormatByCode(buf[1]);
  if (!format) return undefined;
  return { kind: 'video', format, payload: buf.subarray(2) };
}
