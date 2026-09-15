import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredUser } from '../lib/auth';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: getStoredUser() ? '/new' : '/login' });
  },
});
