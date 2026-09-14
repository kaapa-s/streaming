import { BadRequestException } from '@nestjs/common';
import type { PlatformProvider } from './platform-ids';

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const META_INGEST = 'rtmps://live-api-s.facebook.com:443/rtmp';

/** Accept a full RTMP(S) URL, or a bare key when the ingest host is known. */
export function normalizeOutboundRtmp(input: string, platform: PlatformProvider): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BadRequestException('Stream key is empty');
  }

  if (/^rtmps?:\/\//i.test(trimmed)) {
    return assertRtmpUrlHasKey(trimmed);
  }

  if (platform === 'youtube') {
    if (BARE_KEY.test(trimmed) && trimmed.length >= 8) {
      return `rtmp://a.rtmp.youtube.com/live2/${trimmed}`;
    }
    throw new BadRequestException(
      'Provide a full RTMP URL (rtmp://a.rtmp.youtube.com/live2/<key>) or just the YouTube stream key',
    );
  }

  if (platform === 'facebook' || platform === 'instagram') {
    if (/\s/.test(trimmed)) {
      throw new BadRequestException(
        'Provide a full RTMPS URL or the Facebook/Instagram Live Producer stream key (no spaces)',
      );
    }
    return assertRtmpUrlHasKey(`${META_INGEST}/${trimmed}`);
  }

  const source = platform === 'x' ? 'X Media Studio' : 'LinkedIn Live';
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
