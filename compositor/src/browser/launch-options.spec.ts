import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compositorChromeLaunchOptions } from './launch-options';

describe('compositorChromeLaunchOptions', () => {
  it('stays new-headless on Linux GPU (no Xvfb)', () => {
    const opts = compositorChromeLaunchOptions(true, 'vulkan', 'linux');
    assert.equal(opts.headless, true);
    assert.ok(opts.ignoreDefaultArgs.includes('--disable-gpu'));
    assert.ok(opts.args.includes('--use-angle=vulkan'));
    assert.equal(opts.args.includes('--disable-vulkan-surface'), false);
  });

  it('opens headed Chrome on macOS when GPU is requested (local probe)', () => {
    const opts = compositorChromeLaunchOptions(true, 'gl', 'darwin');
    assert.equal(opts.headless, false);
  });

  it('stays new-headless on CPU boxes', () => {
    const opts = compositorChromeLaunchOptions(false, 'gl', 'linux');
    assert.equal(opts.headless, true);
    assert.equal(opts.ignoreDefaultArgs.includes('--disable-gpu'), false);
    assert.equal(opts.args.includes('--enable-gpu'), false);
  });
});
