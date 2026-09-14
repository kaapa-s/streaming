import { chromeGpuArgs, resolveAngleBackend } from './gpu';

export interface CompositorChromeLaunchOptions {
  timeout: number;
  headless: boolean;
  ignoreDefaultArgs: string[];
  args: string[];
}

/**
 * Shared Puppeteer launch options for the pool and the local GPU probe.
 *
 * Linux stays new-headless (ozone-headless). ANGLE over EGL gets a hardware
 * output surface there, so no Xvfb and no X server are needed.
 */
export function compositorChromeLaunchOptions(
  gpuEnabled: boolean,
  platform: NodeJS.Platform = process.platform,
  angle: string = resolveAngleBackend(),
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
      ...chromeGpuArgs(gpuEnabled, platform, angle),
      ...(process.env.NODE_ENV !== 'production' ? ['--ignore-certificate-errors'] : []),
    ],
  };
}
