import { BadRequestException } from '@nestjs/common';
import { spawnSync } from 'child_process';
import { AUDIO, type StreamProfile } from '@streaming/stream-quality';

export const OUTBOUND_PLATFORMS = [
  'youtube',
  'facebook',
  'linkedin',
  'instagram',
  'x',
] as const;

export type OutboundPlatform = (typeof OUTBOUND_PLATFORMS)[number];

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const META_INGEST = 'rtmps://live-api-s.facebook.com:443/rtmp';

export function isOutboundPlatform(value: string): value is OutboundPlatform {
  return (OUTBOUND_PLATFORMS as readonly string[]).includes(value);
}

export function assertFfmpegAvailable(): void {
  const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const result = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new BadRequestException(
      `ffmpeg not found (${bin}). Install it (e.g. brew install ffmpeg) to go live.`,
    );
  }
}

export function collectRtmpUrls(opts: { rtmpUrl?: string; rtmpUrls?: string[] }): string[] {
  const fromList = (opts.rtmpUrls ?? []).map((s) => s.trim()).filter(Boolean);
  const single = opts.rtmpUrl?.trim();
  const all = single ? [single, ...fromList] : fromList;
  return [...new Set(all)];
}

/**
 * Accept a full RTMP(S) URL, or a bare stream key when the platform ingest host is known.
 * Without `platform`, bare keys are treated as YouTube (legacy go-live).
 */
export function normalizeRtmpUrl(input: string, platform?: OutboundPlatform): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BadRequestException('Stream key is empty');
  }

  if (/^rtmps?:\/\//i.test(trimmed)) {
    return assertRtmpUrlHasKey(trimmed);
  }

  const target = platform ?? 'youtube';
  if (target === 'youtube') {
    if (BARE_KEY.test(trimmed) && trimmed.length >= 8) {
      return `rtmp://a.rtmp.youtube.com/live2/${trimmed}`;
    }
    throw new BadRequestException(
      'Provide a full RTMP URL (rtmp://a.rtmp.youtube.com/live2/<key>) or just the YouTube stream key',
    );
  }

  if (target === 'facebook' || target === 'instagram') {
    if (/\s/.test(trimmed)) {
      throw new BadRequestException(
        'Provide a full RTMPS URL or the Facebook/Instagram Live Producer stream key (no spaces)',
      );
    }
    return assertRtmpUrlHasKey(`${META_INGEST}/${trimmed}`);
  }

  const source = target === 'x' ? 'X Media Studio' : 'LinkedIn Live';
  throw new BadRequestException(
    `Paste the full RTMP URL including stream key from ${source}`,
  );
}

function assertRtmpUrlHasKey(input: string): string {
  try {
    const u = new URL(input);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new BadRequestException(
        'RTMP URL must include the stream key, e.g. rtmp://a.rtmp.youtube.com/live2/<key>',
      );
    }
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException('Invalid RTMP URL');
  }
  return input;
}

export function redactRtmp(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    if (parts.length > 0) parts[parts.length - 1] = '***';
    u.pathname = parts.join('/');
    return u.toString();
  } catch {
    return 'rtmp://***';
  }
}

/** Escape `: \\ | [ ] { } space` so ffmpeg tee does not split the URL. */
export function escapeTeeUrl(url: string): string {
  return url.replace(/[\\{}: |[\]]/g, '\\$&');
}

export function buildTeeSpec(urls: string[]): string {
  return urls.map((url) => `[f=flv:onfail=ignore]${escapeTeeUrl(url)}`).join('|');
}

export function redactFfmpegArg(arg: string): string {
  const unescaped = arg.replace(/\\(.)/g, '$1');
  return unescaped.replace(/rtmps?:\/\/[^\s|]+/gi, (match) => redactRtmp(match));
}

export function buildFfmpegArgs(
  profile: StreamProfile,
  codec: string,
  urls: string[],
): string[] {
  if (urls.length === 0) {
    throw new BadRequestException('at least one RTMP URL is required');
  }

  const commonHead = [
    '-hide_banner',
    '-loglevel',
    'info',
    '-stats_period',
    '5',
    '-fflags',
    '+genpts',
    '-i',
    'pipe:0',
  ];
  const audio = [
    '-af',
    AUDIO.ffmpegResampleFilter,
    '-c:a',
    'aac',
    '-b:a',
    profile.rtmpAudioBitrate,
    '-ar',
    String(AUDIO.sampleRate),
    '-ac',
    String(AUDIO.channels),
  ];
  const maps = ['-map', '0:v:0', '-map', '0:a:0?'];
  const out =
    urls.length === 1
      ? ['-f', 'flv', urls[0]]
      : ['-f', 'tee', '-use_fifo', '1', '-fifo_options', 'drop_pkts_on_overflow=1:attempt_recovery=1', buildTeeSpec(urls)];

  if (codec === 'h264') {
    return [...commonHead, ...maps, '-c:v', 'copy', ...audio, ...out];
  }

  return [
    ...commonHead,
    ...maps,
    '-c:v',
    'libx264',
    '-preset',
    profile.ffmpegPreset,
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(profile.fps * 2),
    '-keyint_min',
    String(profile.fps * 2),
    '-sc_threshold',
    '0',
    '-b:v',
    profile.rtmpVideoBitrate,
    '-maxrate',
    profile.rtmpMaxrate,
    '-bufsize',
    profile.rtmpBufsize,
    ...audio,
    ...out,
  ];
}
