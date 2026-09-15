import { Outlet, createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStudioController } from '../../hooks/useStudioController';
import { createStudioHandle } from '../../studio/studioHandle';
import { ensureAuthenticated } from '../../studio/studioStage';

/**
 * A room. The slug sits on this layout route so the layout itself can read it
 * and scope one studio controller to it — children (`/` pre-join, `/live`)
 * share that controller through route context.
 */
export const Route = createFileRoute('/r/$slug')({
  context: () => ({
    studioHandle: createStudioHandle(),
  }),
  beforeLoad: ({ context, location }) => {
    // An invitee who is signed out lands on /login and comes back here.
    ensureAuthenticated(context.studioHandle, location.href);
  },
  component: RoomLayout,
});

function RoomLayout() {
  const router = useRouter();
  const { slug } = Route.useParams();
  const { studioHandle } = Route.useRouteContext();
  const studio = useStudioController(slug);

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
