import { useEffect, useState } from 'react';
import { apiFetch, getAccessToken } from '../lib/auth';
import {
  emptyPlatformStatus,
  PLATFORM_META,
  PLATFORM_PROVIDERS,
  type AllPlatformStatus,
  type PlatformProvider,
} from '../lib/platforms';

async function parseError(res: Response): Promise<string> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return `${res.status} ${res.statusText || 'request failed'}`.trim();
  }
  const record = typeof body === 'object' && body !== null ? body : {};
  const raw =
    'message' in record
      ? Array.isArray(record.message)
        ? record.message.join(', ')
        : record.message
      : undefined;
  return typeof raw === 'string' && raw.trim() ? raw : `${res.status} ${res.statusText}`.trim();
}

export function usePlatformConnections(signedIn: boolean, setError: (message: string) => void) {
  const [status, setStatus] = useState<AllPlatformStatus>(emptyPlatformStatus);
  const [pendingProvider, setPendingProvider] = useState<PlatformProvider | null>(null);

  const refresh = async () => {
    if (!signedIn || !getAccessToken()) return;
    try {
      const res = await apiFetch('/api/platforms');
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      const body = (await res.json()) as Partial<AllPlatformStatus>;
      setStatus({ ...emptyPlatformStatus(), ...body });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!signedIn) {
      setStatus(emptyPlatformStatus());
      return;
    }
    void refresh();
    // refresh closes over signedIn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let touched = false;
    for (const provider of PLATFORM_PROVIDERS) {
      const value = params.get(provider);
      if (!value) continue;
      touched = true;
      if (value === 'connected') {
        void refresh();
      } else if (value === 'error') {
        const message = params.get('message') || `${PLATFORM_META[provider].label} connect failed`;
        console.error(`[platforms] ${provider} oauth callback error`, message);
        setError(message);
      }
      params.delete(provider);
    }
    if (!touched) return;
    params.delete('message');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setError]);

  const connect = async (provider: PlatformProvider) => {
    setPendingProvider(provider);
    setError('');
    try {
      const res = await apiFetch(`/api/platforms/${provider}/connect`);
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPendingProvider(null);
    }
  };

  const disconnect = async (provider: PlatformProvider) => {
    setPendingProvider(provider);
    setError('');
    try {
      const res = await apiFetch(`/api/platforms/${provider}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await parseError(res));
      setStatus((prev) => ({ ...prev, [provider]: { connected: false } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingProvider(null);
    }
  };

  return {
    status,
    pendingProvider,
    connect,
    disconnect,
    refresh,
  };
}
