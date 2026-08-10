import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredUser } from '../lib/auth';
import { keepStudioSearch, parseStudioSearch } from '../lib/studioSearch';

export const Route = createFileRoute('/')({
  validateSearch: parseStudioSearch,
  beforeLoad: () => {
    const user = getStoredUser();
    throw redirect({
      to: user ? '/join' : '/login',
      search: keepStudioSearch,
    });
  },
});
