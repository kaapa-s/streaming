import type { ChromeGpuBackend } from './gpu';
import { chromeGpuArgs } from './gpu';

export interface CompositorChromeLaunchOptions {
  timeout: number;
  headless: boolean;
  ignoreDefaultArgs: string[];
  args: string[];
}

/**
 * Shared Puppeteer launch options for the pool and local GPU probe.
 * Stay headless (ozone-headless). Headed + Xvfb is a Tesla fallback, not default.
 */
export function compositorChromeLaunchOptions(
  gpuEnabled: boolean,
  backend: ChromeGpuBackend,
  platform: NodeJS.Platform = process.platform,
): CompositorChromeLaunchOptions {
  const ignoreDefaultArgs = gpuEnabled
    ? ['--mute-audio', '--disable-gpu', '--use-angle=swiftshader-webgl']
    : ['--mute-audio'];
  return {
    timeout: 30_000,
    // Puppeteer 25: true = new headless (ozone-headless). false = headed (macOS local).
    headless: !(gpuEnabled && platform === 'darwin'),
    ignoreDefaultArgs,
    args: [
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...chromeGpuArgs(gpuEnabled, backend, platform),
      ...(process.env.NODE_ENV !== 'production' ? ['--ignore-certificate-errors'] : []),
    ],
  };
}
