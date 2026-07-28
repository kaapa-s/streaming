import { createFileRoute } from '@tanstack/react-router';
import { Studio } from '../pages/Studio';

export const Route = createFileRoute('/')({
  component: Studio,
});
