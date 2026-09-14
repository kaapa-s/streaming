import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STREAM_PROFILES } from '@streaming/stream-quality';
import { detectNvenc, buildNvencFfmpegArgs, nvencTrialFailure } from './nvenc';
import { redactFfmpegArg } from './rtmp';

/** Stubs the two ffmpeg calls detectNvenc makes: `-encoders`, then a trial encode. */
function stubFfmpeg(opts: { listed?: string; trialStatus?: number; trialOut?: string }) {
  return (_bin: string, args: string[]) => {
    if (args.includes('-encoders')) {
      return { stdout: opts.listed ?? ' V..... h264_nvenc  NVIDIA NVENC H.264 encoder', status: 0 };
    }
    return { stdout: opts.trialOut ?? '', status: opts.trialStatus ?? 0 };
  };
}

describe('detectNvenc', () => {
  const gpuOn = { enabled: true, reason: 'COMPOSITOR_GPU=1' };
  const gpuOff = { enabled: false, reason: 'no GPU' };

  it('is off when GPU passthrough is off', () => {
    assert.equal(detectNvenc(gpuOff, {}, stubFfmpeg({})), false);
  });

  it('is off when ffmpeg has no h264_nvenc', () => {
    assert.equal(detectNvenc(gpuOn, {}, stubFfmpeg({ listed: ' libx264 ' })), false);
  });

  it('is on when GPU is on and a trial encode succeeds', () => {
    assert.equal(detectNvenc(gpuOn, {}, stubFfmpeg({})), true);
  });

  it('is off when the encoder is listed but will not open', () => {
    // The real regression: the ffmpeg build has h264_nvenc, the host driver is
    // older than that build's NVENC API, and the encoder only fails on open.
    assert.equal(
      detectNvenc(
        gpuOn,
        {},
        stubFfmpeg({
          trialStatus: 1,
          trialOut: 'Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0',
        }),
      ),
      false,
    );
  });

  it('is off when ffmpeg cannot be spawned at all', () => {
    assert.equal(
      detectNvenc(gpuOn, {}, () => ({ stdout: '', status: null, error: new Error('ENOENT') })),
      false,
    );
  });

  it('honors COMPOSITOR_NVENC=0', () => {
    assert.equal(detectNvenc(gpuOn, { COMPOSITOR_NVENC: '0' }, stubFfmpeg({})), false);
  });
});

describe('nvencTrialFailure', () => {
  it('is undefined when the trial encode succeeds', () => {
    assert.equal(nvencTrialFailure({}, stubFfmpeg({})), undefined);
  });

  it('reports the driver mismatch for the boot log', () => {
    const why = nvencTrialFailure(
      {},
      stubFfmpeg({
        trialStatus: 1,
        trialOut: 'Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0\nmore',
      }),
    );
    assert.ok(why?.includes('Required: 13.1 Found: 13.0'));
  });
});

describe('buildNvencFfmpegArgs', () => {
  const profile = STREAM_PROFILES['1080p'];

  it('writes WebM only when there is no RTMP URL', () => {
    const args = buildNvencFfmpegArgs(profile, '/tmp/out.webm', []);
    assert.ok(args.includes('h264_nvenc'));
    assert.ok(args.includes('pipe:0'));
    assert.ok(args.includes('pipe:3'));
    assert.ok(args.includes('libopus'));
    assert.ok(args.includes('/tmp/out.webm'));
    assert.equal(args.includes('tee'), false);
  });

  it('defaults the raw input to yuv420p and honors the frame format', () => {
    const i420 = buildNvencFfmpegArgs(profile, '/tmp/out.webm', []);
    assert.equal(i420[i420.indexOf('rawvideo') + 2], 'yuv420p');
    const nv12 = buildNvencFfmpegArgs(profile, '/tmp/out.webm', [], 'nv12');
    assert.equal(nv12[nv12.indexOf('rawvideo') + 2], 'nv12');
    // The NVENC *output* stays yuv420p regardless of what came in.
    assert.equal(nv12.lastIndexOf('yuv420p') > nv12.indexOf('h264_nvenc'), true);
  });

  it('tees WebM + RTMP with one NVENC encode and split audio', () => {
    const args = buildNvencFfmpegArgs(profile, '/tmp/out.webm', [
      'rtmp://a.rtmp.youtube.com/live2/secretkey',
    ]);
    assert.equal(args.filter((a) => a === 'h264_nvenc').length, 1);
    assert.ok(args.includes('tee'));
    const spec = args.at(-1) ?? '';
    assert.ok(spec.includes('f=webm'));
    assert.ok(spec.includes('f=flv'));
    assert.equal(redactFfmpegArg(spec).includes('secretkey'), false);
  });
});
