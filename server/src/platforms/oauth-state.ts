import { createHmac, timingSafeEqual } from 'crypto';

export interface OAuthStatePayload {
  userId: string;
  exp: number;
  provider?: string;
  codeVerifier?: string;
}

function secret(): string {
  return process.env.JWT_SECRET ?? 'dev-insecure-jwt-secret-change-me';
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

/** Short-lived signed state for OAuth round-trip (binds callback to user). */
export function signOAuthState(
  userId: string,
  extra: { provider?: string; codeVerifier?: string } = {},
  ttlSec = 600,
): string {
  const payload: OAuthStatePayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    ...extra,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const [body, sigB64] = state.split('.');
  if (!body || !sigB64) throw new Error('invalid oauth state');
  const expected = createHmac('sha256', secret()).update(body).digest();
  const actual = fromB64url(sigB64);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('invalid oauth state signature');
  }
  const payload = JSON.parse(fromB64url(body).toString('utf8')) as OAuthStatePayload;
  if (!payload.userId || typeof payload.exp !== 'number') {
    throw new Error('invalid oauth state payload');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('oauth state expired');
  }
  return payload;
}
