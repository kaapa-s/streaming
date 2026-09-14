import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import { detectNvenc, nvencTrialFailure } from '../recordings/nvenc';
import {
  assertHardwareGpuCompositing,
  assertHardwareGpuRenderer,
  detectGpu,
  isGpuStrict,
  probeGpuRendererInPage,
  resolveAngleBackend,
  summarizeChromeGpuPage,
  type GpuDetection,
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
  private readonly gpuAngle = resolveAngleBackend();
  private gpuRenderer: string | undefined;
  private gpuPageSummary: string | undefined;
  private gpuFeatureStatus: GpuFeatureStatus | undefined;
  private gpuEncode: GpuEncodeMode = 'mediarecorder';
  private gpuError: string | undefined;

  gpuStatus(): {
    enabled: boolean;
    reason: string;
    renderer?: string;
    angle: string;
    compositing?: string;
    featureStatus?: GpuFeatureStatus;
    encode: GpuEncodeMode;
    chromeGpu?: string;
    error?: string;
  } {
    const detection = detectGpu();
    return {
      ...detection,
      renderer: this.gpuRenderer,
      angle: this.gpuAngle,
      compositing: this.gpuFeatureStatus?.gpu_compositing,
      featureStatus: this.gpuFeatureStatus,
      encode: this.gpuEncode,
      chromeGpu: this.gpuPageSummary,
      error: this.gpuError,
    };
  }

  async onModuleInit(): Promise<void> {
    const size = Math.max(1, Number(process.env.COMPOSITOR_POOL_SIZE ?? 1) || 1);
    const gpu = detectGpu();
    this.gpuEncode = detectNvenc(gpu) ? 'nvenc' : 'mediarecorder';
    if (gpu.enabled && this.gpuEncode === 'mediarecorder' && process.env.COMPOSITOR_NVENC !== '0') {
      // Falling back is safe, but silently is not: this is the difference
      // between a GPU encode and a CPU one, and it turns on the host driver.
      const why = nvencTrialFailure();
      if (why) {
        this.logger.warn(
          `h264_nvenc will not open (${why}) — encoding with MediaRecorder H.264 instead. ` +
            'Chromium still renders on the GPU.',
        );
      }
    }
    this.logger.log(
      `warming Chromium pool size=${size} gpu=${gpu.enabled} (${gpu.reason}) ` +
        `angle=${this.gpuAngle} encode=${this.gpuEncode}`,
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

  /**
   * One launch, one diagnostic pass. There is no backend ladder: ANGLE over EGL
   * is the only Linux configuration that composites on hardware, and
   * COMPOSITOR_ANGLE overrides it for experiments.
   *
   * A GPU verdict never takes the service down unless COMPOSITOR_GPU_STRICT=1 —
   * a crash-looping container cannot be inspected, which is how the last GPU
   * regression hid itself behind four bogus verify-script failures.
   */
  private async launchBrowser(): Promise<Browser> {
    const gpu = detectGpu();
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch(
        compositorChromeLaunchOptions(gpu.enabled, process.platform, this.gpuAngle),
      );
      await this.captureGpuDiagnostics(browser, gpu);
      return browser;
    } catch (err) {
      await browser?.close().catch(() => undefined);
      if (!gpu.enabled || isGpuStrict()) throw err;
      this.gpuError = String(err);
      this.logger.error(
        `Chromium GPU launch failed (${this.gpuError}) — falling back to CPU rendering. ` +
          'Set COMPOSITOR_GPU_STRICT=1 to fail the container instead.',
      );
    }
    const cpu = await puppeteer.launch(
      compositorChromeLaunchOptions(false, process.platform, this.gpuAngle),
    );
    await this.captureGpuDiagnostics(cpu, { enabled: false, reason: 'gpu launch failed' });
    return cpu;
  }

  /**
   * Records renderer + featureStatus *before* asserting, so /internal/health and
   * the logs explain a bad GPU even when the verdict is fatal.
   */
  private async captureGpuDiagnostics(browser: Browser, gpu: GpuDetection): Promise<void> {
    const renderer = await this.probeRenderer(browser);
    const featureStatus = await probeGpuFeatureStatus(browser);
    this.gpuRenderer = renderer;
    this.gpuFeatureStatus = featureStatus;
    this.gpuPageSummary = await this.probeChromeGpuPage(browser);
    this.logger.log(
      `Chromium GPU renderer: ${renderer} (ANGLE ${this.gpuAngle}) ` +
        `compositing=${featureStatus.gpu_compositing ?? 'unknown'} ` +
        `2d_canvas=${featureStatus['2d_canvas'] ?? 'unknown'} ` +
        `video_decode=${featureStatus.video_decode ?? 'unknown'}`,
    );
    if (this.gpuPageSummary) {
      this.logger.log(`chrome://gpu ${this.gpuPageSummary}`);
    }

    try {
      assertHardwareGpuRenderer(gpu, renderer, this.gpuAngle);
      assertHardwareGpuCompositing(gpu, this.gpuAngle, featureStatus);
      this.gpuError = undefined;
    } catch (err) {
      this.gpuError = String(err);
      if (isGpuStrict()) throw err;
      this.logger.error(
        `${this.gpuError} — serving anyway on CPU. ` +
          'Set COMPOSITOR_GPU_STRICT=1 to fail the container instead.',
      );
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
