/** Chromium must load the recorder from this container (Nest on loopback). */

export function resolveRecorderPageOrigin(env: NodeJS.ProcessEnv = process.env): {
  origin: string;
  ignored?: string;
} {
  const port = env.PORT?.trim() || '3002';
  const fallback = `http://127.0.0.1:${port}`;
  const raw = env.COMPOSITOR_PAGE_ORIGIN?.trim();
  if (!raw) return { origin: fallback };
  try {
    const u = new URL(raw);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
      return { origin: raw.replace(/\/$/, '') };
    }
  } catch {
    /* invalid URL */
  }
  return { origin: fallback, ignored: raw };
}

export function isLoopbackCompositorUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    return loopback && u.pathname.startsWith('/compositor');
  } catch {
    return false;
  }
}

export function redactCompositorUrl(url: string): string {
  return url.replace(/([?&]token=)[^&]+/gi, '$1***');
}
