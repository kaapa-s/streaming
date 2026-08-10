import { Outlet, createFileRoute, retainSearchParams, useRouter } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStudioController } from '../hooks/useStudioController';
import { parseStudioSearch } from '../lib/studioSearch';
import { createStudioHandle } from '../studio/studioHandle';

export const Route = createFileRoute('/_studio')({
  validateSearch: parseStudioSearch,
  search: {
    middlewares: [retainSearchParams(['room', 'auto'])],
  },
  // Stable for the lifetime of this match — children inherit it via route context.
  context: () => ({
    studioHandle: createStudioHandle(),
  }),
  component: StudioLayout,
});

function StudioLayout() {
  const router = useRouter();
  const { room } = Route.useSearch();
  const { studioHandle } = Route.useRouteContext();
  const studio = useStudioController(room);

  // Publish during render so child getSnapshot() sees the latest value;
  // notify after commit so subscribers re-render without updating during render.
  studioHandle.publish(studio);
  useLayoutEffect(() => {
    studioHandle.notify();
  }, [studio, studioHandle]);

  // Re-run child beforeLoad guards when auth/session stage changes.
  const stage = `${studio.user?.id ?? ''}:${studio.joined ? 1 : 0}`;
  const skipFirstStageEffect = useRef(true);
  useEffect(() => {
    if (skipFirstStageEffect.current) {
      skipFirstStageEffect.current = false;
      return;
    }
    void router.invalidate();
  }, [stage, router]);

  return <Outlet />;
}
