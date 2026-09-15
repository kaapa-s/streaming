/**
 * `?redirect=` carries an invitee back to the room after they log in.
 *
 * It is attacker-supplied (it comes from a link someone was sent), so only
 * same-origin paths are honoured: a bare `/...` that is not protocol-relative
 * (`//evil.example`) and not an absolute URL. Anything else falls back to the
 * default landing page rather than being followed.
 */
const FALLBACK = '/new';

export function parseRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return isSameOriginPath(value) ? value : undefined;
}

export function safeRedirect(value: unknown): string {
  return parseRedirect(value) ?? FALLBACK;
}

function isSameOriginPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  // `//host` and `/\host` are protocol-relative — they leave the origin.
  if (value.startsWith('//') || value.startsWith('/\\')) return false;
  return true;
}
