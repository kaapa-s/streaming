import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chromeGpuArgs, detectGpu, isSwiftShaderRenderer } from './gpu';

describe('detectGpu', () => {
  it('honors COMPOSITOR_GPU=0 even when a device exists', () => {
    const got = detectGpu({ COMPOSITOR_GPU: '0' }, () => true);
    assert.deepEqual(got, { enabled: false, reason: 'COMPOSITOR_GPU=0' });
  });

  it('honors COMPOSITOR_GPU=1 without a device', () => {
    const got = detectGpu({ COMPOSITOR_GPU: '1' }, () => false);
    assert.deepEqual(got, { enabled: true, reason: 'COMPOSITOR_GPU=1' });
  });

  it('treats NVIDIA_VISIBLE_DEVICES as GPU passthrough', () => {
    const got = detectGpu({ NVIDIA_VISIBLE_DEVICES: 'all' }, () => false);
    assert.equal(got.enabled, true);
    assert.match(got.reason, /NVIDIA_VISIBLE_DEVICES/);
  });

  it('ignores NVIDIA_VISIBLE_DEVICES=void', () => {
    const got = detectGpu({ NVIDIA_VISIBLE_DEVICES: 'void' }, () => false);
    assert.equal(got.enabled, false);
  });

  it('detects /dev/nvidia0', () => {
    const got = detectGpu({}, (p) => p === '/dev/nvidia0');
    assert.deepEqual(got, { enabled: true, reason: '/dev/nvidia0' });
  });

  it('detects /dev/dri/renderD128', () => {
    const got = detectGpu({}, (p) => p === '/dev/dri/renderD128');
    assert.deepEqual(got, { enabled: true, reason: '/dev/dri/renderD128' });
  });

  it('stays off when nothing is present', () => {
    const got = detectGpu({}, () => false);
    assert.deepEqual(got, { enabled: false, reason: 'no GPU device in container' });
  });
});

describe('chromeGpuArgs', () => {
  it('is empty when GPU is off', () => {
    assert.deepEqual(chromeGpuArgs(false), []);
  });

  it('asks ANGLE for a real GL device when GPU is on', () => {
    const args = chromeGpuArgs(true);
    assert.ok(args.includes('--use-gl=angle'));
    assert.ok(args.includes('--use-angle=gl'));
    assert.ok(args.includes('--ignore-gpu-blocklist'));
    assert.ok(args.includes('--enable-accelerated-2d-canvas'));
  });

  it('can request Vulkan ANGLE for headless NVIDIA', () => {
    const args = chromeGpuArgs(true, 'vulkan');
    assert.ok(args.includes('--use-angle=vulkan'));
    assert.ok(args.includes('--disable-vulkan-surface'));
    assert.ok(args.some((a) => a.includes('VulkanFromANGLE')));
  });
});

describe('isSwiftShaderRenderer', () => {
  it('flags software renderers', () => {
    assert.equal(isSwiftShaderRenderer('Google SwiftShader'), true);
    assert.equal(isSwiftShaderRenderer('NVIDIA Tesla T4'), false);
  });
});
