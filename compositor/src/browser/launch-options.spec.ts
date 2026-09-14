import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compositorChromeLaunchOptions } from './launch-options';

describe('compositorChromeLaunchOptions', () => {
  it('stays new-headless on Linux GPU — EGL needs no X server, so no Xvfb', () => {
    const opts = compositorChromeLaunchOptions(true, 'linux');
    assert.equal(opts.headless, true);
    assert.ok(opts.ignoreDefaultArgs.includes('--disable-gpu'));
    assert.ok(opts.args.includes('--use-angle=gl-egl'));
    assert.ok(opts.args.includes('--use-cmd-decoder=passthrough'));
    assert.equal(opts.args.includes('--disable-vulkan-surface'), false);
  });

  it('passes a COMPOSITOR_ANGLE override through to Chromium', () => {
    const opts = compositorChromeLaunchOptions(true, 'linux', 'vulkan');
    assert.ok(opts.args.includes('--use-angle=vulkan'));
  });

  it('opens headed Chrome on macOS when GPU is requested (local probe)', () => {
    const opts = compositorChromeLaunchOptions(true, 'darwin');
    assert.equal(opts.headless, false);
  });

  it('stays new-headless on CPU boxes', () => {
    const opts = compositorChromeLaunchOptions(false, 'linux');
    assert.equal(opts.headless, true);
    assert.equal(opts.ignoreDefaultArgs.includes('--disable-gpu'), false);
    assert.equal(opts.args.includes('--enable-gpu'), false);
  });
});
