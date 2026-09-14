import { BadRequestException } from '@nestjs/common';
import { PLATFORM_LABELS, type PlatformProvider } from './platform-ids';
import { webOrigin } from './env';

export function oauthRedirect(provider: PlatformProvider, ok: boolean, message?: string): string {
  const studioUrl = `${webOrigin()}/settings`;
  if (ok) return `${studioUrl}?${provider}=connected`;
  const msg = encodeURIComponent(message?.trim() || `${PLATFORM_LABELS[provider]} connect failed`);
  return `${studioUrl}?${provider}=error&message=${msg}`;
}

export function oauthErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof BadRequestException) {
    const res = err.getResponse();
    if (typeof res === 'string') return res;
    if (typeof res === 'object' && res && 'message' in res) {
      const msg = (res as { message: string | string[] }).message;
      return Array.isArray(msg) ? msg.join(', ') : msg;
    }
  }
  return err instanceof Error ? err.message : fallback;
}

export async function parseOAuthJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON */
  }
  return { error: text.slice(0, 200) };
}

export function jsonString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function jsonNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
