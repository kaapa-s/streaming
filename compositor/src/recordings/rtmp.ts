import { BadRequestException } from '@nestjs/common';
import { spawnSync } from 'child_process';

export function assertFfmpegAvailable(): void {
  const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const result = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new BadRequestException(
      `ffmpeg not found (${bin}). Install it (e.g. brew install ffmpeg) to go live on YouTube.`,
    );
  }
}

/** Accept a full RTMP URL, or a bare YouTube stream key. */
export function normalizeRtmpUrl(input: string): string {
  if (/^rtmps?:\/\//i.test(input)) {
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

  if (/^[A-Za-z0-9_-]+$/.test(input) && input.length >= 8) {
    return `rtmp://a.rtmp.youtube.com/live2/${input}`;
  }

  throw new BadRequestException(
    'Provide a full RTMP URL (rtmp://a.rtmp.youtube.com/live2/<key>) or just the YouTube stream key',
  );
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
