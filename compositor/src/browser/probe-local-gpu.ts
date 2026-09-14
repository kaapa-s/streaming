/**
 * Local GPU compositing probe. Headed on macOS, new-headless on Linux.
 *
 *   COMPOSITOR_GPU=1 npx ts-node --transpile-only src/browser/probe-local-gpu.ts
 */
import puppeteer from 'puppeteer';
import { isGpuCompositingEnabled } from './gpu';
import { probeGpuFeatureStatus } from './gpu-cdp';
import { compositorChromeLaunchOptions } from './launch-options';

async function probe(backend: 'gl' | 'vulkan'): Promise<{
  backend: 'gl' | 'vulkan';
  compositing?: string;
  featureStatus: Record<string, string>;
}> {
  const opts = compositorChromeLaunchOptions(true, backend);
  const browser = await puppeteer.launch(opts);
  try {
    const featureStatus = await probeGpuFeatureStatus(browser);
    return {
      backend,
      compositing: featureStatus.gpu_compositing,
      featureStatus,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  process.env.COMPOSITOR_GPU ??= '1';
  const headed = process.platform === 'darwin';
  console.log(
    `probe-local-gpu platform=${process.platform} headed=${headed} COMPOSITOR_GPU=${process.env.COMPOSITOR_GPU}`,
  );

  let lastError: unknown;
  const backends: Array<'gl' | 'vulkan'> =
    process.platform === 'darwin' ? ['gl'] : ['gl', 'vulkan'];
  for (const backend of backends) {
    try {
      const result = await probe(backend);
      console.log(JSON.stringify(result, null, 2));
      if (isGpuCompositingEnabled(result.compositing)) {
        console.log(`PASS gpu_compositing=${result.compositing} ANGLE ${backend}`);
        return;
      }
      lastError = new Error(
        `gpu_compositing=${result.compositing ?? 'unknown'} on ANGLE ${backend}`,
      );
      console.warn(`ANGLE ${backend}: ${String(lastError)}`);
    } catch (err) {
      lastError = err;
      console.warn(`ANGLE ${backend} launch/probe failed: ${String(err)}`);
    }
  }
  console.error(`FAIL ${String(lastError)}`);
  process.exitCode = 1;
}

void main();
