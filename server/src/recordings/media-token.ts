import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Short-lived, room-scoped token that lets a browser fetch a room's recorded
 * output through the API without a Bearer header. `<video>`/`<a download>` cannot
 * attach an Authorization header, so the media endpoint authorizes the request
 * from this signed token instead. Cloud deployments keep using S3 presigned
 * URLs; this covers local/self-hosted media.
 */
export interface MediaTokenPayload {
  roomId: string;
  userId: string;
  exp: number;
}

function signingKey(): Buffer {
  const secret =
    process.env.MEDIA_SIGNING_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'dev-insecure-jwt-secret-change-me';
  // Domain-separate from access-token signing even when JWT_SECRET is reused.
  return createHmac('sha256', secret).update('room-media-file-v1').digest();
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function sign(body: string): string {
  return createHmac('sha256', signingKey()).update(body).digest('base64url');
}

export function issueMediaToken(roomId: string, userId: string, ttlSeconds = 60 * 60): string {
  const payload: MediaTokenPayload = {
    roomId,
    userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyMediaToken(token: string): MediaTokenPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new Error('invalid media token');
  const expected = sign(body);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw new Error('invalid media token signature');
  }
  let payload: MediaTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MediaTokenPayload;
  } catch {
    throw new Error('invalid media token payload');
  }
  if (!payload.roomId || !payload.userId || typeof payload.exp !== 'number') {
    throw new Error('invalid media token claims');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('media token expired');
  }
  return payload;
}
