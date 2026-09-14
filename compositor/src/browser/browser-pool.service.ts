import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import {
  chromeGpuArgs,
  detectGpu,
  isSwiftShaderRenderer,
  probeGpuRendererInPage,
  summarizeChromeGpuPage,
  type ChromeGpuBackend,
} from './gpu';

interface PoolSlot {
  browser: Browser;
  busy: boolean;
}

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private slots: PoolSlot[] = [];
  private gpuRenderer: string | undefined;
  private gpuBackend: ChromeGpuBackend = 'gl';
  private gpuPageSummary: string | undefined;

  gpuStatus(): {
    enabled: boolean;
    reason: string;
    renderer?: string;
    backend?: ChromeGpuBackend;
    chromeGpu?: string;
  } {
    const detection = detectGpu();
    return {
      ...detection,
      renderer: this.gpuRenderer,
      backend: this.gpuBackend,
      chromeGpu: this.gpuPageSummary,
    };
  }

  async onModuleInit(): Promise<void> {
    const size = Math.max(1, Number(process.env.COMPOSITOR_POOL_SIZE ?? 1) || 1);
    const gpu = detectGpu();
    this.logger.log(`warming Chromium pool size=${size} gpu=${gpu.enabled} (${gpu.reason})`);
    for (let i = 0; i < size; i++) {
      const browser = await this.launchBrowser();
      this.slots.push({ browser, busy: false });
    }
    this.logger.log(
      `Chromium pool ready (${this.slots.length} browsers) renderer=${this.gpuRenderer ?? 'unknown'}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      this.slots.map(async (slot) => {
        await slot.browser.close().catch(() => undefined);
      }),
    );
    this.slots = [];
  }

  freeSlots(): number {
    return this.slots.filter((s) => !s.busy).length;
  }

  activeSlots(): number {
    return this.slots.filter((s) => s.busy).length;
  }

  async claim(): Promise<Browser> {
    const slot = this.slots.find((s) => !s.busy);
    if (!slot) {
      throw new Error('compositor pool exhausted — no free Chromium slots');
    }
    slot.busy = true;
    if (!slot.browser.connected) {
      this.logger.warn('pool browser disconnected; relaunching');
      slot.browser = await this.launchBrowser();
    }
    return slot.browser;
  }

  release(browser: Browser): void {
    const slot = this.slots.find((s) => s.browser === browser);
    if (slot) slot.busy = false;
  }

  private async launchBrowser(): Promise<Browser> {
    const gpu = detectGpu();
    if (!gpu.enabled) {
      const browser = await this.launchWithBackend('gl');
      await this.captureGpuDiagnostics(browser, gpu, 'gl');
      return browser;
    }

    const preferred = this.gpuRenderer ? this.gpuBackend : 'gl';
    const first = await this.launchWithBackend(preferred);
    const firstRenderer = await this.probeRenderer(first);
    if (!isSwiftShaderRenderer(firstRenderer) || preferred === 'vulkan') {
      await this.captureGpuDiagnostics(first, gpu, preferred, firstRenderer);
      return first;
    }

    this.logger.warn(
      `ANGLE GL is ${firstRenderer}; retrying Chromium with Vulkan (typical on Tesla/headless NVIDIA)`,
    );
    await first.close().catch(() => undefined);
    const second = await this.launchWithBackend('vulkan');
    const secondRenderer = await this.probeRenderer(second);
    await this.captureGpuDiagnostics(second, gpu, 'vulkan', secondRenderer);
    return second;
  }

  private launchWithBackend(backend: ChromeGpuBackend): Promise<Browser> {
    const gpu = detectGpu();
    return puppeteer.launch({
      // Puppeteer adds --mute-audio by default. That zeroes the Web Audio graph
      // the recorder mixes into MediaRecorder — YouTube/RTMP gets video, no audio.
      // Studio feedback is unaffected (client-side video-only tiles).
      ignoreDefaultArgs: ['--mute-audio', '--disable-gpu'],
      args: [
        '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        // Headless tabs are treated as backgrounded; throttling the compositor
        // draw/audio graph produces the same crackles as a starved main thread.
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        ...chromeGpuArgs(gpu.enabled, backend),
        // Local SFU may use HTTPS/WSS with a self-signed or mkcert cert.
        ...(process.env.NODE_ENV !== 'production'
          ? ['--ignore-certificate-errors']
          : []),
      ],
    });
  }

  private async captureGpuDiagnostics(
    browser: Browser,
    gpu: { enabled: boolean; reason: string },
    backend: ChromeGpuBackend,
    renderer?: string,
  ): Promise<void> {
    this.gpuBackend = backend;
    this.gpuRenderer = renderer ?? (await this.probeRenderer(browser));
    this.gpuPageSummary = await this.probeChromeGpuPage(browser);
    if (gpu.enabled && isSwiftShaderRenderer(this.gpuRenderer)) {
      this.logger.warn(
        `GPU requested (${gpu.reason}, ANGLE ${backend}) but Chromium is on ${this.gpuRenderer} — ` +
          'nvidia-smi will stay at 0%. Run ./scripts/verify-compositor-gpu.sh on the box.',
      );
    } else {
      this.logger.log(`Chromium GPU renderer: ${this.gpuRenderer} (ANGLE ${backend})`);
    }
    if (this.gpuPageSummary) {
      this.logger.log(`chrome://gpu ${this.gpuPageSummary}`);
    }
  }

  private async probeRenderer(browser: Browser): Promise<string> {
    const page = await browser.newPage();
    try {
      return await page.evaluate(probeGpuRendererInPage);
    } catch (err) {
      return `probe-failed: ${String(err)}`;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async probeChromeGpuPage(browser: Browser): Promise<string> {
    const page = await browser.newPage();
    try {
      await page.goto('chrome://gpu', { waitUntil: 'domcontentloaded', timeout: 10_000 });
      return await page.evaluate(summarizeChromeGpuPage);
    } catch (err) {
      return `chrome://gpu failed: ${String(err)}`;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
