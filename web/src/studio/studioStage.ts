import { redirect } from '@tanstack/react-router';
import { getStoredUser } from '../lib/auth';
import { keepStudioSearch } from '../lib/studioSearch';
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
    throw redirect({ to: '/dashboard', replace: true, search: keepStudioSearch });
  }
}

/** Authenticated app shell (New recording, Settings). */
export function ensureAuthenticated(studioHandle: StudioHandle, allowInvite = false): void {
  if (!readUser(studioHandle) && !allowInvite) {
    throw redirect({ to: '/login', replace: true, search: keepStudioSearch });
  }
}

/** `/join` — authenticated transition into the requested SFU session. */
export function ensureJoinLobby(studioHandle: StudioHandle, search: { room?: string; invite?: string }): void {
  if (!search.room && !search.invite && readUser(studioHandle)) {
    throw redirect({ to: '/dashboard', replace: true, search: keepStudioSearch });
  }
  ensureAuthenticated(studioHandle, Boolean(search.invite));
}

/** `/live` — signed in and joined. */
export function ensureLiveSession(studioHandle: StudioHandle): void {
  // An admitted guest has a scoped SFU token but no application JWT.
  if (!readJoined(studioHandle) && !readUser(studioHandle)) {
    throw redirect({ to: '/login', replace: true, search: keepStudioSearch });
  }
  if (!readJoined(studioHandle)) {
    throw redirect({ to: '/join', replace: true, search: keepStudioSearch });
  }
}
