import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { chromeGpuArgs, detectGpu, isSwiftShaderRenderer, probeGpuRendererInPage } from './gpu';

interface PoolSlot {
  browser: Browser;
  busy: boolean;
}

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private slots: PoolSlot[] = [];
  private gpuRenderer: string | undefined;

  gpuStatus(): { enabled: boolean; reason: string; renderer?: string } {
    const detection = detectGpu();
    return { ...detection, renderer: this.gpuRenderer };
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
    const browser = await puppeteer.launch({
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
        ...chromeGpuArgs(gpu.enabled),
        // Local SFU may use HTTPS/WSS with a self-signed or mkcert cert.
        ...(process.env.NODE_ENV !== 'production'
          ? ['--ignore-certificate-errors']
          : []),
      ],
    });
    if (!this.gpuRenderer) {
      this.gpuRenderer = await this.probeRenderer(browser);
      if (gpu.enabled && isSwiftShaderRenderer(this.gpuRenderer)) {
        this.logger.warn(
          `GPU requested but Chromium is on ${this.gpuRenderer} — ` +
            'the container likely has no NVIDIA graphics libs. ' +
            'Install nvidia-container-toolkit and redeploy with compose.gpu.yml',
        );
      } else {
        this.logger.log(`Chromium GPU renderer: ${this.gpuRenderer}`);
      }
    }
    return browser;
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
}
