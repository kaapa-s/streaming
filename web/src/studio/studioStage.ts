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

/** Public auth pages — only for signed-out users. An invite returns to `/join`. */
export function ensureLoggedOut(
  studioHandle: StudioHandle,
  search?: { room?: string; invite?: string },
): void {
  if (!readUser(studioHandle)) return;
  const invite = search?.invite?.trim();
  if (invite) {
    throw redirect({ to: '/join', replace: true, search: { room: search?.room ?? '', invite } });
  }
  throw redirect({ to: '/dashboard', replace: true, search: keepStudioSearch });
}

/** Authenticated app shell (New recording, Settings) and room entry. */
export function ensureAuthenticated(studioHandle: StudioHandle): void {
  if (!readUser(studioHandle)) {
    throw redirect({ to: '/login', replace: true, search: keepStudioSearch });
  }
}

/** `/join` — authenticated transition into the requested SFU session. */
export function ensureJoinLobby(studioHandle: StudioHandle, search: { room?: string; invite?: string }): void {
  if (!search.room && !search.invite && readUser(studioHandle)) {
    throw redirect({ to: '/dashboard', replace: true, search: keepStudioSearch });
  }
  // Invite links require an account: the invite is preserved through login, and
  // the server keys membership by the authenticated user id.
  ensureAuthenticated(studioHandle);
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
