import { spawnSync } from 'child_process';
import { AUDIO, type StreamProfile } from '@streaming/stream-quality';
import type { GpuDetection } from '../browser/gpu';
import { escapeTeeUrl } from './rtmp';

export type SpawnEncoders = (
  bin: string,
  args: string[],
) => { stdout: string; status: number | null; error?: Error };

function defaultSpawnEncoders(bin: string, args: string[]) {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  return {
    stdout: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    status: result.status,
    error: result.error,
  };
}

/**
 * True when this process should encode with ffmpeg NVENC instead of Chrome
 * MediaRecorder. Needs GPU passthrough and an ffmpeg built with h264_nvenc
 * (Debian's ffmpeg is not).
 */
export function detectNvenc(
  gpu: GpuDetection,
  env: NodeJS.Dict<string> = process.env,
  spawnEncoders: SpawnEncoders = defaultSpawnEncoders,
): boolean {
  if (!gpu.enabled) return false;
  if (env.COMPOSITOR_NVENC === '0') return false;
  const bin = env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const result = spawnEncoders(bin, ['-hide_banner', '-encoders']);
  if (result.error || result.status !== 0) return false;
  return /\bh264_nvenc\b/.test(result.stdout);
}

function nvencVideoArgs(profile: StreamProfile): string[] {
  const gop = String(profile.fps * 2);
  return [
    '-c:v',
    'h264_nvenc',
    '-preset',
    'p4',
    '-rc',
    'vbr',
    '-profile:v',
    'high',
    '-b:v',
    profile.rtmpVideoBitrate,
    '-maxrate',
    profile.rtmpMaxrate,
    '-bufsize',
    profile.rtmpBufsize,
    '-g',
    gop,
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
  ];
}

function rawInputs(profile: StreamProfile): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'info',
    '-stats_period',
    '5',
    '-fflags',
    '+genpts',
    '-thread_queue_size',
    '512',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'yuv420p',
    '-s:v',
    `${profile.width}x${profile.height}`,
    '-r',
    String(profile.fps),
    '-i',
    'pipe:0',
    '-thread_queue_size',
    '512',
    '-f',
    'f32le',
    '-ar',
    String(AUDIO.sampleRate),
    '-ac',
    String(AUDIO.channels),
    '-i',
    'pipe:3',
  ];
}

/**
 * ffmpeg args: I420 + f32le PCM in, NVENC H.264 out.
 * Archive is always H.264+Opus WebM. Live RTMP adds AAC via tee (one NVENC encode).
 */
export function buildNvencFfmpegArgs(
  profile: StreamProfile,
  file: string,
  urls: string[],
): string[] {
  const head = rawInputs(profile);
  const video = nvencVideoArgs(profile);

  if (urls.length === 0) {
    return [
      ...head,
      ...video,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-af',
      AUDIO.ffmpegResampleFilter,
      '-c:a',
      'libopus',
      '-b:a',
      profile.rtmpAudioBitrate,
      '-ar',
      String(AUDIO.sampleRate),
      '-ac',
      String(AUDIO.channels),
      '-f',
      'webm',
      file,
    ];
  }

  const rtmpParts = urls
    .map((url) => `[select='v:0,a:1':f=flv:onfail=ignore]${escapeTeeUrl(url)}`)
    .join('|');
  const tee = `[select='v:0,a:0':f=webm]${escapeTeeUrl(file)}|${rtmpParts}`;
  return [
    ...head,
    '-filter_complex',
    `[1:a]${AUDIO.ffmpegResampleFilter},asplit=2[aopus][aaac]`,
    '-map',
    '0:v:0',
    '-map',
    '[aopus]',
    '-map',
    '[aaac]',
    ...video,
    '-c:a:0',
    'libopus',
    '-b:a:0',
    profile.rtmpAudioBitrate,
    '-c:a:1',
    'aac',
    '-b:a:1',
    profile.rtmpAudioBitrate,
    '-f',
    'tee',
    '-use_fifo',
    '1',
    '-fifo_options',
    'drop_pkts_on_overflow=1:attempt_recovery=1',
    tee,
  ];
}
