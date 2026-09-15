import { Outlet, createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStudioController } from '../hooks/useStudioController';
import { createStudioHandle } from '../studio/studioHandle';

/**
 * Auth shell: login, signup, new stream, settings. No room is in scope here —
 * rooms live under `/r/$slug`, which mounts its own controller.
 */
export const Route = createFileRoute('/_studio')({
  // Stable for the lifetime of this match — children inherit it via route context.
  context: () => ({
    studioHandle: createStudioHandle(),
  }),
  component: StudioLayout,
});

function StudioLayout() {
  const router = useRouter();
  const { studioHandle } = Route.useRouteContext();
  const studio = useStudioController(null);

  // Publish during render so child getSnapshot() sees the latest value;
  // notify after commit so subscribers re-render without updating during render.
  studioHandle.publish(studio);
  useLayoutEffect(() => {
    studioHandle.notify();
  }, [studio, studioHandle]);

  // Re-run child beforeLoad guards when auth changes.
  const stage = studio.user?.id ?? '';
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
