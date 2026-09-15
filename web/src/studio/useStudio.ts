import { useRouteContext } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import type { StudioHandle, StudioValue } from './studioHandle';

/**
 * Reactive studio state published into route context.
 *
 * Non-strict on purpose: two layouts publish a handle — the auth shell
 * (`/_studio`) and a room (`/r/$slug`) — and the nearest one wins. That keeps
 * every shared component working under both without knowing which it is in.
 */
export function useStudio(): StudioValue {
  const handle = useRouteContext({
    strict: false,
    select: (ctx) => ctx.studioHandle as StudioHandle | undefined,
  });
  if (!handle) throw new Error('useStudio() used outside a studio layout route');
  return useSyncExternalStore(handle.subscribe, handle.getSnapshot);
}
