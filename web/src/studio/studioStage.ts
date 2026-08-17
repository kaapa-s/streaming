import { redirect } from '@tanstack/react-router';
import { getStoredUser } from '../lib/auth';
import { keepStudioSearch, liveStudioSearch } from '../lib/studioSearch';
import type { StudioHandle } from './studioHandle';

function readUser(studioHandle: StudioHandle) {
  return studioHandle.tryGet()?.user ?? getStoredUser();
}

function readJoined(studioHandle: StudioHandle) {
  return studioHandle.tryGet()?.joined ?? false;
}

/** Public auth pages — only for signed-out users. */
export function ensureLoggedOut(studioHandle: StudioHandle): void {
  if (readUser(studioHandle)) {
    throw redirect({ to: '/join', replace: true, search: keepStudioSearch });
  }
}

/** Authenticated app shell (New recording, Settings). */
export function ensureAuthenticated(studioHandle: StudioHandle): void {
  if (!readUser(studioHandle)) {
    throw redirect({ to: '/login', replace: true, search: keepStudioSearch });
  }
}

/** `/join` — signed in, not yet in the SFU session. */
export function ensureJoinLobby(studioHandle: StudioHandle): void {
  ensureAuthenticated(studioHandle);
  if (readJoined(studioHandle)) {
    throw redirect({ to: '/live', replace: true, search: liveStudioSearch });
  }
}

/** `/live` — signed in and joined. */
export function ensureLiveSession(studioHandle: StudioHandle): void {
  if (!readUser(studioHandle)) {
    throw redirect({ to: '/login', replace: true, search: keepStudioSearch });
  }
  if (!readJoined(studioHandle)) {
    throw redirect({ to: '/join', replace: true, search: keepStudioSearch });
  }
}
