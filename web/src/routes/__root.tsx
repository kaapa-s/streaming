import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { QueryClient } from '@tanstack/react-query';
import type { StudioHandle } from '../studio/studioHandle';

export type RouterContext = {
  queryClient: QueryClient;
  /**
   * Published by whichever studio layout is mounted — the auth shell (`_studio`)
   * or a room (`/r/$slug`). `useStudio()` reads the nearest one, so components
   * shared between the two need no import change.
   */
  studioHandle: StudioHandle | undefined;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </>
  );
}
