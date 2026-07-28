import { createFileRoute } from '@tanstack/react-router';
import { CompositorDev } from '../pages/CompositorDev';

export const Route = createFileRoute('/compositor-dev')({
  component: CompositorDev,
});
