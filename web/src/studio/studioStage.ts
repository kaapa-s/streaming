import { redirect } from '@tanstack/react-router';
import { getStoredUser } from '../lib/auth';
import { safeRedirect } from '../lib/redirectTo';
import type { StudioHandle } from './studioHandle';

function readUser(studioHandle: StudioHandle | undefined) {
  return studioHandle?.tryGet()?.user ?? getStoredUser();
}

function readJoined(studioHandle: StudioHandle | undefined) {
  return studioHandle?.tryGet()?.joined ?? false;
}

/** Public auth pages — only for signed-out users. Honours `?redirect=`. */
export function ensureLoggedOut(
  studioHandle: StudioHandle | undefined,
  search: { redirect?: string },
): void {
  if (readUser(studioHandle)) {
    throw redirect({ to: safeRedirect(search.redirect), replace: true });
  }
}

/**
 * Anything behind a login. Carries the current path through as `?redirect=` so
 * someone opening an invite link while signed out lands back on the room.
 */
export function ensureAuthenticated(
  studioHandle: StudioHandle | undefined,
  href?: string,
): void {
  if (!readUser(studioHandle)) {
    throw redirect({
      to: '/login',
      replace: true,
      search: href ? { redirect: href } : undefined,
    });
  }
}

/** `/r/$slug/live` — signed in and already through the pre-join screen. */
export function ensureLiveSession(
  studioHandle: StudioHandle | undefined,
  slug: string,
  href?: string,
): void {
  ensureAuthenticated(studioHandle, href);
  if (!readJoined(studioHandle)) {
    // A refresh lands here: the camera grant is gone, so go back and re-join.
    throw redirect({ to: '/r/$slug', params: { slug }, replace: true });
  }
}
