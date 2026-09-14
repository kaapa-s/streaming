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
 * Encodes one black frame. Listing h264_nvenc only proves the ffmpeg build was
 * compiled with it — opening it also needs a host driver new enough for that
 * build's NVENC API. A driver that is too old fails here with "Driver does not
 * support the required nvenc API version", and the encoder never opens.
 */
export const NVENC_TRIAL_ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=black:s=256x144:r=30',
  '-frames:v',
  '1',
  '-c:v',
  'h264_nvenc',
  '-f',
  'null',
  '-',
];

/**
 * True when this process should encode with ffmpeg NVENC instead of Chrome
 * MediaRecorder. Needs GPU passthrough and an ffmpeg whose h264_nvenc actually
 * opens against the installed driver — so this runs a trial encode rather than
 * trusting `-encoders`, which lists the encoder even when the driver is too old.
 *
 * Returning false is a safe degrade: the caller falls back to MediaRecorder
 * H.264, which streams without the GPU encoder.
 */
export function detectNvenc(
  gpu: GpuDetection,
  env: NodeJS.Dict<string> = process.env,
  spawnEncoders: SpawnEncoders = defaultSpawnEncoders,
): boolean {
  if (!gpu.enabled) return false;
  if (env.COMPOSITOR_NVENC === '0') return false;
  const bin = env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const listed = spawnEncoders(bin, ['-hide_banner', '-encoders']);
  if (listed.error || listed.status !== 0) return false;
  if (!/\bh264_nvenc\b/.test(listed.stdout)) return false;
  const trial = spawnEncoders(bin, NVENC_TRIAL_ARGS);
  if (trial.error || trial.status !== 0) return false;
  return true;
}

/** Why the trial encode failed, for the boot log. */
export function nvencTrialFailure(
  env: NodeJS.Dict<string> = process.env,
  spawnEncoders: SpawnEncoders = defaultSpawnEncoders,
): string | undefined {
  const bin = env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const trial = spawnEncoders(bin, NVENC_TRIAL_ARGS);
  if (!trial.error && trial.status === 0) return undefined;
  const detail = trial.error ? String(trial.error) : trial.stdout.trim();
  return detail.split(/\r?\n/).filter(Boolean).slice(0, 3).join(' / ') || 'unknown error';
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

function rawInputs(profile: StreamProfile, pixFmt: string): string[] {
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
    pixFmt,
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
 * ffmpeg args: raw video (`pixFmt`, as the page reported it) + f32le PCM in,
 * NVENC H.264 out.
 * Archive is always H.264+Opus WebM. Live RTMP adds AAC via tee (one NVENC encode).
 */
export function buildNvencFfmpegArgs(
  profile: StreamProfile,
  file: string,
  urls: string[],
  pixFmt = 'yuv420p',
): string[] {
  const head = rawInputs(profile, pixFmt);
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
