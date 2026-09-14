import { TargetType, type Browser, type CDPSession } from 'puppeteer';
import type { GpuFeatureStatus } from './gpu';

interface SystemInfoGpuResult {
  gpu?: {
    featureStatus?: GpuFeatureStatus;
  };
}

async function browserTargetSession(browser: Browser): Promise<CDPSession> {
  const browserTarget =
    browser.targets().find((target) => target.type() === TargetType.BROWSER) ??
    browser.target();
  return browserTarget.createCDPSession();
}

/** CDP SystemInfo.getInfo must run on the browser target, not a page. */
export async function probeGpuFeatureStatus(browser: Browser): Promise<GpuFeatureStatus> {
  let session: CDPSession | undefined;
  try {
    session = await browserTargetSession(browser);
    const info = (await session.send('SystemInfo.getInfo')) as SystemInfoGpuResult;
    return info.gpu?.featureStatus ?? {};
  } catch (err) {
    return { probe_error: String(err) };
  } finally {
    await session?.detach().catch(() => undefined);
  }
}
