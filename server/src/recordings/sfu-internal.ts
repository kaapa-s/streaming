/**
 * Internal control channel from the API to the SFU.
 *
 * `SFU_INTERNAL_SECRET` is preferred, but local/dev deployments already share
 * `SFU_JOIN_SECRET` between the two processes, so fall back to it instead of
 * silently degrading kick/cleanup to a no-op. `SFU_INTERNAL_URL` defaults to the
 * local SFU origin; production should set it explicitly.
 */
export function sfuInternalConfig(): { base: string; secret: string } | null {
  const base = process.env.SFU_INTERNAL_URL?.trim() || 'http://127.0.0.1:3001';
  const secret = process.env.SFU_INTERNAL_SECRET?.trim() || process.env.SFU_JOIN_SECRET?.trim();
  if (!base || !secret) return null;
  return { base: base.replace(/\/$/, ''), secret };
}

export async function postSfuInternal(path: string, body?: unknown): Promise<void> {
  const config = sfuInternalConfig();
  if (!config) return;
  await fetch(`${config.base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': config.secret,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
