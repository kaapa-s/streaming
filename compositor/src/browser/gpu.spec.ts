import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertHardwareGpuCompositing,
  assertHardwareGpuRenderer,
  chromeGpuArgs,
  detectGpu,
  isGpuCompositingEnabled,
  isGpuStrict,
  isSoftwareGpuRenderer,
  isSwiftShaderRenderer,
  resolveAngleBackend,
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

  it('asks ANGLE for EGL on Linux — GLX needs a DISPLAY containers do not have', () => {
    const args = chromeGpuArgs(true, 'linux');
    assert.ok(args.includes('--use-gl=angle'));
    assert.ok(args.includes('--use-angle=gl-egl'));
    assert.ok(args.includes('--use-cmd-decoder=passthrough'));
    assert.ok(args.includes('--ignore-gpu-blocklist'));
    assert.ok(args.includes('--enable-accelerated-2d-canvas'));
    assert.ok(args.includes('--disable-gpu-sandbox'));
    assert.equal(args.includes('--use-angle=gl'), false);
    assert.equal(args.some((a) => /Vaapi/i.test(a)), false);
  });

  it('keeps the software fallback so a GPU failure names SwiftShader, not no-webgl', () => {
    const args = chromeGpuArgs(true, 'linux');
    assert.equal(args.includes('--disable-software-rasterizer'), false);
  });

  it('sets no Vulkan features — they move viz onto Vulkan, which needs a surface', () => {
    const args = chromeGpuArgs(true, 'linux');
    assert.equal(args.some((a) => /VulkanFromANGLE|DefaultANGLEVulkan/.test(a)), false);
    assert.equal(args.includes('--disable-vulkan-surface'), false);
  });

  it('lets COMPOSITOR_ANGLE pick another backend', () => {
    const args = chromeGpuArgs(true, 'linux', 'vulkan');
    assert.ok(args.includes('--use-angle=vulkan'));
    assert.equal(args.includes('--use-angle=gl-egl'), false);
  });

  it('uses Metal-friendly flags on macOS (no NVIDIA ANGLE)', () => {
    const args = chromeGpuArgs(true, 'darwin');
    assert.ok(args.includes('--enable-gpu'));
    assert.equal(args.some((a) => a.startsWith('--use-angle=')), false);
    assert.equal(args.includes('--disable-software-rasterizer'), false);
  });
});

describe('resolveAngleBackend', () => {
  it('defaults to gl-egl', () => {
    assert.equal(resolveAngleBackend({}), 'gl-egl');
  });

  it('honors COMPOSITOR_ANGLE', () => {
    assert.equal(resolveAngleBackend({ COMPOSITOR_ANGLE: 'vulkan' }), 'vulkan');
  });

  it('ignores an empty COMPOSITOR_ANGLE', () => {
    assert.equal(resolveAngleBackend({ COMPOSITOR_ANGLE: '  ' }), 'gl-egl');
  });
});

describe('isGpuStrict', () => {
  it('is off by default so a GPU verdict cannot crash-loop the container', () => {
    assert.equal(isGpuStrict({}), false);
    assert.equal(isGpuStrict({ COMPOSITOR_GPU_STRICT: '0' }), false);
    assert.equal(isGpuStrict({ COMPOSITOR_GPU_STRICT: '1' }), true);
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
      () => assertHardwareGpuRenderer(gpu, 'Google SwiftShader', 'gl-egl'),
      /must run on the GPU/,
    );
  });

  it('allows a real NVIDIA renderer', () => {
    assertHardwareGpuRenderer(gpu, 'NVIDIA Tesla T4', 'gl-egl');
  });

  it('is a no-op when GPU is not requested', () => {
    assertHardwareGpuRenderer(
      { enabled: false, reason: 'COMPOSITOR_GPU=0' },
      'Google SwiftShader',
      'gl-egl',
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
        assertHardwareGpuCompositing(gpu, 'gl-egl', {
          gpu_compositing: 'disabled_software',
        }),
      /gpu_compositing=disabled_software/,
    );
  });

  it('allows enabled compositing', () => {
    assertHardwareGpuCompositing(gpu, 'gl-egl', { gpu_compositing: 'enabled' });
  });

  it('is a no-op when GPU is not requested', () => {
    assertHardwareGpuCompositing(
      { enabled: false, reason: 'COMPOSITOR_GPU=0' },
      'gl-egl',
      { gpu_compositing: 'disabled_software' },
    );
  });
});
