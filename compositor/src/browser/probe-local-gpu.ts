/**
 * Chromium GPU probe. Launches one browser with the production flags and prints
 * what Chrome actually did, then exits — no Nest, no pool, no recorder page.
 *
 * In the container (this is what verify-compositor-gpu.sh runs):
 *   docker compose -f compose.yml -f compose.gpu.yml --env-file .env \
 *     run --rm --entrypoint node compositor dist/browser/probe-local-gpu.js
 *
 * Locally:
 *   COMPOSITOR_GPU=1 npm run probe:gpu --prefix compositor
 *
 * COMPOSITOR_ANGLE picks the backend (gl-egl, gles-egl, vulkan, swiftshader).
 */
import puppeteer from 'puppeteer';
import {
  detectGpu,
  isGpuCompositingEnabled,
  isSoftwareGpuRenderer,
  probeGpuRendererInPage,
  resolveAngleBackend,
} from './gpu';
import { probeGpuFeatureStatus } from './gpu-cdp';
import { compositorChromeLaunchOptions } from './launch-options';

async function main(): Promise<void> {
  process.env.COMPOSITOR_GPU ??= '1';
  const gpu = detectGpu();
  const angle = resolveAngleBackend();
  const options = compositorChromeLaunchOptions(gpu.enabled);

  console.log(`platform  : ${process.platform} headless=${options.headless}`);
  console.log(`gpu       : ${gpu.enabled} (${gpu.reason})`);
  console.log(`angle     : ${angle}`);

  const browser = await puppeteer.launch(options);
  try {
    const page = await browser.newPage();
    const renderer = await page.evaluate(probeGpuRendererInPage);
    await page.close().catch(() => undefined);
    const featureStatus = await probeGpuFeatureStatus(browser);

    console.log(`renderer  : ${renderer}`);
    for (const key of Object.keys(featureStatus).sort()) {
      console.log(`  ${key.padEnd(30)} ${featureStatus[key]}`);
    }

    const compositing = featureStatus.gpu_compositing;
    const hardware = !isSoftwareGpuRenderer(renderer);
    console.log('');
    if (!gpu.enabled) {
      console.log('SKIP — GPU not requested (COMPOSITOR_GPU=0 or no device)');
      return;
    }
    if (hardware && isGpuCompositingEnabled(compositing)) {
      console.log(`PASS — ${renderer}, gpu_compositing=${compositing}`);
      return;
    }
    if (hardware) {
      console.log(
        `FAIL — hardware renderer but gpu_compositing=${compositing ?? 'unknown'}; ` +
          'Blink will rasterize the 2D canvas on CPU',
      );
    } else {
      console.log(`FAIL — renderer is ${renderer} (no hardware GPU)`);
    }
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

void main().catch((err: unknown) => {
  console.error(`probe failed: ${String(err)}`);
  process.exitCode = 1;
});
