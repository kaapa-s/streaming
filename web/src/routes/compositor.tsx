import { createFileRoute } from '@tanstack/react-router';
import { CompositorPage } from '../pages/Compositor';

export const Route = createFileRoute('/compositor')({
  component: CompositorPage,
});
