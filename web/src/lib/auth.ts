const ACCESS_KEY = 'streaming-access-token';
const REFRESH_KEY = 'streaming-refresh-token';
const USER_KEY = 'streaming-user';

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

async function refreshAccessToken(): Promise<string | null> {
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
}

/** Authenticated fetch; refreshes once on 401. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
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

export async function joinRoom(slug: string): Promise<{
  room: { id: string; slug: string };
  role: string;
  joinToken: string;
  sfuUrl?: string;
}> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}/join`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
