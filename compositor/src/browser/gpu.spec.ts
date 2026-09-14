import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertHardwareGpuCompositing,
  assertHardwareGpuRenderer,
  chromeGpuArgs,
  detectGpu,
  isGpuCompositingEnabled,
  isSoftwareGpuRenderer,
  isSwiftShaderRenderer,
} from './gpu';

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
    const args = chromeGpuArgs(true, 'gl', 'linux');
    assert.ok(args.includes('--use-gl=angle'));
    assert.ok(args.includes('--use-angle=gl'));
    assert.ok(args.includes('--ignore-gpu-blocklist'));
    assert.ok(args.includes('--enable-accelerated-2d-canvas'));
    assert.ok(args.includes('--disable-gpu-sandbox'));
    assert.ok(args.includes('--disable-software-rasterizer'));
    assert.equal(args.some((a) => /Vaapi/i.test(a)), false);
  });

  it('can request Vulkan ANGLE without disabling the swapchain', () => {
    const args = chromeGpuArgs(true, 'vulkan', 'linux');
    assert.ok(args.includes('--use-angle=vulkan'));
    assert.equal(args.includes('--disable-vulkan-surface'), false);
    assert.ok(args.some((a) => a.includes('VulkanFromANGLE')));
  });

  it('uses Metal-friendly flags on macOS (no NVIDIA ANGLE)', () => {
    const args = chromeGpuArgs(true, 'vulkan', 'darwin');
    assert.ok(args.includes('--enable-gpu'));
    assert.equal(args.includes('--use-angle=vulkan'), false);
    assert.equal(args.includes('--disable-software-rasterizer'), false);
  });
});

describe('isSwiftShaderRenderer', () => {
  it('flags software renderers', () => {
    assert.equal(isSwiftShaderRenderer('Google SwiftShader'), true);
    assert.equal(isSwiftShaderRenderer('NVIDIA Tesla T4'), false);
  });
});

describe('assertHardwareGpuRenderer', () => {
  const gpu = { enabled: true, reason: 'COMPOSITOR_GPU=1' };

  it('treats SwiftShader, llvmpipe, and failed probes as CPU', () => {
    assert.equal(isSoftwareGpuRenderer('Google SwiftShader'), true);
    assert.equal(isSoftwareGpuRenderer('llvmpipe'), true);
    assert.equal(isSoftwareGpuRenderer('probe-failed: boom'), true);
    assert.equal(isSoftwareGpuRenderer('no-webgl'), true);
    assert.equal(isSoftwareGpuRenderer('NVIDIA Tesla T4'), false);
  });

  it('throws when GPU was requested but Chromium is on CPU', () => {
    assert.throws(
      () => assertHardwareGpuRenderer(gpu, 'Google SwiftShader', 'gl'),
      /must run on the GPU/,
    );
  });

  it('allows a real NVIDIA renderer', () => {
    assertHardwareGpuRenderer(gpu, 'NVIDIA Tesla T4', 'vulkan');
  });

  it('is a no-op when GPU is not requested', () => {
    assertHardwareGpuRenderer(
      { enabled: false, reason: 'COMPOSITOR_GPU=0' },
      'Google SwiftShader',
      'gl',
    );
  });
});

describe('gpu compositing', () => {
  const gpu = { enabled: true, reason: 'COMPOSITOR_GPU=1' };

  it('treats enabled / enabled_on / enabled_force as GPU compositing', () => {
    assert.equal(isGpuCompositingEnabled('enabled'), true);
    assert.equal(isGpuCompositingEnabled('enabled_on'), true);
    assert.equal(isGpuCompositingEnabled('enabled_force'), true);
    assert.equal(isGpuCompositingEnabled('disabled_software'), false);
    assert.equal(isGpuCompositingEnabled(undefined), false);
  });

  it('throws when GPU was requested but compositing is software', () => {
    assert.throws(
      () =>
        assertHardwareGpuCompositing(gpu, 'vulkan', {
          gpu_compositing: 'disabled_software',
        }),
      /gpu_compositing=disabled_software/,
    );
  });

  it('allows enabled compositing', () => {
    assertHardwareGpuCompositing(gpu, 'vulkan', { gpu_compositing: 'enabled' });
  });

  it('is a no-op when GPU is not requested', () => {
    assertHardwareGpuCompositing(
      { enabled: false, reason: 'COMPOSITOR_GPU=0' },
      'gl',
      { gpu_compositing: 'disabled_software' },
    );
  });
});
