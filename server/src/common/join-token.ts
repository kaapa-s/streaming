import { createHmac, timingSafeEqual } from 'crypto';

export type JoinPeerRole = 'speaker' | 'compositor';

export interface JoinTokenPayload {
  roomSlug: string;
  userId: string;
  name: string;
  role: JoinPeerRole;
  exp: number;
}

function secret(): string {
  const value = process.env.SFU_JOIN_SECRET;
  if (!value) throw new Error('SFU_JOIN_SECRET is not set');
  return value;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

/** Short-lived HMAC token for SFU signaling join (shared secret with Plan 2 SFU). */
export function issueJoinToken(
  payload: Omit<JoinTokenPayload, 'exp'>,
  ttlSeconds = 60 * 60,
): string {
  const full: JoinTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

export function verifyJoinToken(token: string): JoinTokenPayload {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('invalid join token');
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('invalid join token signature');
  }
  let payload: JoinTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JoinTokenPayload;
  } catch {
    throw new Error('invalid join token payload');
  }
  if (!payload.roomSlug || !payload.userId || !payload.name || !payload.role || !payload.exp) {
    throw new Error('invalid join token claims');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('join token expired');
  }
  if (payload.role !== 'speaker' && payload.role !== 'compositor') {
    throw new Error('invalid join token role');
  }
  return payload;
}
