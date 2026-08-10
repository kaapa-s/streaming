import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';

interface PoolSlot {
  browser: Browser;
  busy: boolean;
}

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private slots: PoolSlot[] = [];

  async onModuleInit(): Promise<void> {
    const size = Math.max(1, Number(process.env.COMPOSITOR_POOL_SIZE ?? 1) || 1);
    this.logger.log(`warming Chromium pool size=${size}`);
    for (let i = 0; i < size; i++) {
      const browser = await this.launchBrowser();
      this.slots.push({ browser, busy: false });
    }
    this.logger.log(`Chromium pool ready (${this.slots.length} browsers)`);
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

  private launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
      // Puppeteer adds --mute-audio by default. That zeroes the Web Audio graph
      // the recorder mixes into MediaRecorder — YouTube/RTMP gets video, no audio.
      // Studio feedback is unaffected (client-side video-only tiles).
      ignoreDefaultArgs: ['--mute-audio'],
      args: [
        '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        // Local SFU may use HTTPS/WSS with a self-signed or mkcert cert.
        ...(process.env.NODE_ENV !== 'production'
          ? ['--ignore-certificate-errors']
          : []),
      ],
    });
  }
}
