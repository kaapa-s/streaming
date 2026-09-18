const ACCESS_KEY = 'streaming-access-token';
const REFRESH_KEY = 'streaming-refresh-token';
const USER_KEY = 'streaming-user';
const GUEST_ADMISSION_KEY = 'streaming-guest-admission';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getStoredUser(): AuthUser | null {
  return readJson<AuthUser>(USER_KEY);
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(ACCESS_KEY, session.accessToken);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    return msg ?? res.statusText;
  } catch {
    return res.statusText || 'request failed';
  }
}

export async function register(
  email: string,
  password: string,
  name: string,
  signupPassword: string,
): Promise<AuthSession> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, signupPassword }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const session = (await res.json()) as AuthSession;
  saveSession(session);
  return session;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const session = (await res.json()) as AuthSession;
  saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  clearSession();
  if (!refreshToken) return;
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => undefined);
}

/** Access JWTs last 15m; refresh before expiry so Chrome does not log a 401. */
const ACCESS_SKEW_MS = 30_000;

function accessTokenExpiryMs(token: string): number | undefined {
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return undefined;
  try {
    const json: unknown = JSON.parse(
      atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (typeof json !== 'object' || json === null || !('exp' in json)) return undefined;
    const exp = json.exp;
    if (typeof exp !== 'number') return undefined;
    return exp * 1000;
  } catch {
    return undefined;
  }
}

function isAccessTokenExpired(token: string): boolean {
  const expiryMs = accessTokenExpiryMs(token);
  if (expiryMs === undefined) return false;
  return expiryMs - ACCESS_SKEW_MS <= Date.now();
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const session = (await res.json()) as AuthSession;
    saveSession(session);
    return session.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Authenticated fetch; refreshes an expired JWT first, and once more on 401. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let token = getAccessToken();
  if (token && isAccessTokenExpired(token)) {
    token = await refreshAccessToken();
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(input, { ...init, headers });
  if (res.status !== 401) return res;

  const next = await refreshAccessToken();
  if (!next) return res;
  headers.set('Authorization', `Bearer ${next}`);
  res = await fetch(input, { ...init, headers });
  return res;
}

export interface OwnedRoom {
  id: string;
  slug: string;
  name: string;
  status: 'created' | 'active' | 'finished';
  createdAt: string;
  media: {
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    error: string | null;
    file: string | null;
  } | null;
}

export async function listOwnedRooms(): Promise<OwnedRoom[]> {
  const res = await apiFetch('/api/rooms');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<OwnedRoom[]>;
}

export async function discardRoom(slug: string): Promise<void> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}/discard`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function createRoom(name: string): Promise<OwnedRoom> {
  const res = await apiFetch('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<OwnedRoom>;
}

export type GuestAdmission = {
  invite: string;
  room: { id: string; slug: string };
  role: 'owner' | 'speaker' | 'viewer';
  guestId: string | null;
  inScene: boolean;
  joinToken?: string;
  sfuUrl?: string;
  displayName: string;
};

export function saveGuestAdmission(admission: GuestAdmission): void {
  sessionStorage.setItem(GUEST_ADMISSION_KEY, JSON.stringify(admission));
}

export function getGuestAdmission(invite: string): GuestAdmission | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(GUEST_ADMISSION_KEY) ?? 'null') as GuestAdmission | null;
    return value?.invite === invite ? value : null;
  } catch { return null; }
}

export function clearGuestAdmission(): void {
  sessionStorage.removeItem(GUEST_ADMISSION_KEY);
}

/** Admit an invite. A waiting invitee has `inScene: false` and no join token. */
export async function admitInvite(token: string, displayName?: string, guestId?: string): Promise<{
  room: { id: string; slug: string };
  role: 'owner' | 'speaker' | 'viewer';
  guestId: string | null;
  inScene: boolean;
  joinToken?: string;
  sfuUrl?: string;
}> {
  const res = await apiFetch('/api/rooms/invite/admit', {
    method: 'POST',
    body: JSON.stringify({ token, displayName, guestId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export interface RoomInviteSummary {
  id: string;
  createdAt: string;
  revokedAt: string | null;
}

/** Create a reusable invite. The full URL is returned once and never persisted. */
export async function createRoomInvite(slug: string): Promise<{ id: string; token: string; url: string }> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}/invites`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ id: string; token: string; url: string }>;
}

/** Owner-only invite metadata: ids and revocation state, never token material. */
export async function listRoomInvites(slug: string): Promise<RoomInviteSummary[]> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}/invites`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<RoomInviteSummary[]>;
}

export async function revokeRoomInvite(slug: string, inviteId: string): Promise<void> {
  const res = await apiFetch(
    `/api/rooms/${encodeURIComponent(slug)}/invites/${encodeURIComponent(inviteId)}/revoke`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(await parseError(res));
}

export interface RoomMemberSceneResult {
  id: string;
  userId: string;
  inScene: boolean;
}

/** Owner-only: admit an off-scene member to the scene or remove them from it. */
export async function setRoomMemberScene(
  slug: string,
  memberId: string,
  inScene: boolean,
): Promise<RoomMemberSceneResult> {
  const res = await apiFetch(
    `/api/rooms/${encodeURIComponent(slug)}/members/${encodeURIComponent(memberId)}/scene`,
    { method: 'POST', body: JSON.stringify({ inScene }) },
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<RoomMemberSceneResult>;
}

/** Owner-only: remove a member from the room and disconnect their SFU session. */
export async function kickRoomMember(slug: string, memberId: string): Promise<void> {
  const res = await apiFetch(
    `/api/rooms/${encodeURIComponent(slug)}/members/${encodeURIComponent(memberId)}/kick`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(await parseError(res));
}

export async function joinRoom(slug: string): Promise<{
  room: { id: string; slug: string; name: string; status: 'created' | 'active' | 'finished' };
  role: 'owner' | 'speaker' | 'viewer';
  joinToken: string;
  sfuUrl?: string;
}> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}/join`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
