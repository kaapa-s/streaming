import { getRouteApi } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import type { StudioValue } from './studioHandle';

const studioRouteApi = getRouteApi('/_studio');

/** Reactive studio state published by the `/_studio` layout into route context. */
export function useStudio(): StudioValue {
  const handle = studioRouteApi.useRouteContext({ select: (ctx) => ctx.studioHandle });
  return useSyncExternalStore(handle.subscribe, handle.getSnapshot);
}
