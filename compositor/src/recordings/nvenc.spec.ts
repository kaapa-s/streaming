import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STREAM_PROFILES } from '@streaming/stream-quality';
import { detectNvenc, buildNvencFfmpegArgs } from './nvenc';
import { redactFfmpegArg } from './rtmp';

describe('detectNvenc', () => {
  const gpuOn = { enabled: true, reason: 'COMPOSITOR_GPU=1' };
  const gpuOff = { enabled: false, reason: 'no GPU' };

  it('is off when GPU passthrough is off', () => {
    assert.equal(
      detectNvenc(gpuOff, {}, () => ({ stdout: 'h264_nvenc', status: 0 })),
      false,
    );
  });

  it('is off when ffmpeg has no h264_nvenc', () => {
    assert.equal(
      detectNvenc(gpuOn, {}, () => ({ stdout: ' libx264 ', status: 0 })),
      false,
    );
  });

  it('is on when GPU is on and ffmpeg lists h264_nvenc', () => {
    assert.equal(
      detectNvenc(gpuOn, {}, () => ({
        stdout: ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder',
        status: 0,
      })),
      true,
    );
  });

  it('honors COMPOSITOR_NVENC=0', () => {
    assert.equal(
      detectNvenc(gpuOn, { COMPOSITOR_NVENC: '0' }, () => ({
        stdout: 'h264_nvenc',
        status: 0,
      })),
      false,
    );
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
