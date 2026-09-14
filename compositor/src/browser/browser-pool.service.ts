import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { detectNvenc } from '../recordings/nvenc';
import {
  assertHardwareGpuCompositing,
  assertHardwareGpuRenderer,
  detectGpu,
  isSoftwareGpuRenderer,
  probeGpuRendererInPage,
  summarizeChromeGpuPage,
  type ChromeGpuBackend,
  type GpuEncodeMode,
  type GpuFeatureStatus,
} from './gpu';
import { probeGpuFeatureStatus } from './gpu-cdp';
import { compositorChromeLaunchOptions } from './launch-options';

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
  private gpuFeatureStatus: GpuFeatureStatus | undefined;
  private gpuEncode: GpuEncodeMode = 'mediarecorder';

  gpuStatus(): {
    enabled: boolean;
    reason: string;
    renderer?: string;
    backend?: ChromeGpuBackend;
    compositing?: string;
    featureStatus?: GpuFeatureStatus;
    encode: GpuEncodeMode;
    chromeGpu?: string;
  } {
    const detection = detectGpu();
    return {
      ...detection,
      renderer: this.gpuRenderer,
      backend: this.gpuBackend,
      compositing: this.gpuFeatureStatus?.gpu_compositing,
      featureStatus: this.gpuFeatureStatus,
      encode: this.gpuEncode,
      chromeGpu: this.gpuPageSummary,
    };
  }

  async onModuleInit(): Promise<void> {
    const size = Math.max(1, Number(process.env.COMPOSITOR_POOL_SIZE ?? 1) || 1);
    const gpu = detectGpu();
    this.gpuEncode = detectNvenc(gpu) ? 'nvenc' : 'mediarecorder';
    this.logger.log(
      `warming Chromium pool size=${size} gpu=${gpu.enabled} (${gpu.reason}) encode=${this.gpuEncode}`,
    );
    for (let i = 0; i < size; i++) {
      const browser = await this.launchBrowser();
      this.slots.push({ browser, busy: false });
    }
    this.logger.log(
      `Chromium pool ready (${this.slots.length} browsers) renderer=${this.gpuRenderer ?? 'unknown'} ` +
        `compositing=${this.gpuFeatureStatus?.gpu_compositing ?? 'n/a'} encode=${this.gpuEncode}`,
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
      throw new ServiceUnavailableException(
        'compositor pool exhausted — no free Chromium slots',
      );
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
    if (gpu.enabled) {
      return this.launchGpuBrowser(gpu);
    }
    const browser = await this.launchWithBackend('gl', false);
    await this.captureGpuDiagnostics(browser, gpu, 'gl');
    return browser;
  }

  private async launchGpuBrowser(gpu: { enabled: boolean; reason: string }): Promise<Browser> {
    const preferred = this.gpuRenderer ? this.gpuBackend : 'gl';
    const first = await this.tryLaunchWithBackend(preferred, true);
    if (first) {
      const firstRenderer = await this.probeRenderer(first);
      if (preferred === 'vulkan') {
        return this.acceptGpuBrowser(first, gpu, 'vulkan', firstRenderer);
      }
      if (!isSoftwareGpuRenderer(firstRenderer)) {
        const accepted = await this.tryAcceptGpuBrowser(first, gpu, preferred, firstRenderer);
        if (accepted) return accepted;
      } else {
        await first.close().catch(() => undefined);
      }
      this.logger.warn(
        `ANGLE GL is ${firstRenderer} (or software compositing); retrying Chromium with Vulkan`,
      );
    } else if (preferred === 'vulkan') {
      throw new Error(`Chromium Vulkan launch failed (${gpu.reason})`);
    } else {
      this.logger.warn('ANGLE GL launch failed; retrying Chromium with Vulkan');
    }

    const second = await this.launchWithBackend('vulkan', true);
    const secondRenderer = await this.probeRenderer(second);
    return this.acceptGpuBrowser(second, gpu, 'vulkan', secondRenderer);
  }

  private async tryLaunchWithBackend(
    backend: ChromeGpuBackend,
    gpuEnabled: boolean,
  ): Promise<Browser | undefined> {
    try {
      return await this.launchWithBackend(backend, gpuEnabled);
    } catch (err) {
      this.logger.warn(`Chromium launch (ANGLE ${backend}) failed: ${String(err)}`);
      return undefined;
    }
  }

  private async tryAcceptGpuBrowser(
    browser: Browser,
    gpu: { enabled: boolean; reason: string },
    backend: ChromeGpuBackend,
    renderer: string,
  ): Promise<Browser | undefined> {
    try {
      await this.captureGpuDiagnostics(browser, gpu, backend, renderer);
      return browser;
    } catch (err) {
      this.logger.warn(`ANGLE ${backend} rejected: ${String(err)}`);
      await browser.close().catch(() => undefined);
      return undefined;
    }
  }

  private async acceptGpuBrowser(
    browser: Browser,
    gpu: { enabled: boolean; reason: string },
    backend: ChromeGpuBackend,
    renderer: string,
  ): Promise<Browser> {
    try {
      await this.captureGpuDiagnostics(browser, gpu, backend, renderer);
      return browser;
    } catch (err) {
      await browser.close().catch(() => undefined);
      throw err;
    }
  }

  private launchWithBackend(backend: ChromeGpuBackend, gpuEnabled: boolean): Promise<Browser> {
    return puppeteer.launch(compositorChromeLaunchOptions(gpuEnabled, backend));
  }

  private async captureGpuDiagnostics(
    browser: Browser,
    gpu: { enabled: boolean; reason: string },
    backend: ChromeGpuBackend,
    renderer?: string,
  ): Promise<void> {
    const resolvedRenderer = renderer ?? (await this.probeRenderer(browser));
    const featureStatus = await probeGpuFeatureStatus(browser);
    this.gpuPageSummary = await this.probeChromeGpuPage(browser);
    assertHardwareGpuRenderer(gpu, resolvedRenderer, backend);
    assertHardwareGpuCompositing(gpu, backend, featureStatus);
    this.gpuBackend = backend;
    this.gpuRenderer = resolvedRenderer;
    this.gpuFeatureStatus = featureStatus;
    this.logger.log(
      `Chromium GPU renderer: ${resolvedRenderer} (ANGLE ${backend}) ` +
        `compositing=${featureStatus.gpu_compositing ?? 'unknown'}`,
    );
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
