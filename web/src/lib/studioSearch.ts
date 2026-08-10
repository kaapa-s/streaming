/** Shared search params for studio routes (`room`, optional `auto` for e2e). */
export type StudioSearch = {
  room: string;
  auto?: true;
};

export function parseStudioSearch(search: Record<string, unknown>): StudioSearch {
  return {
    room: typeof search.room === 'string' && search.room ? search.room : 'main',
    ...(search.auto === '1' || search.auto === true ? { auto: true as const } : {}),
  };
}

/** Keep `room` / `auto` across studio navigations (redirect search reducer). */
export function keepStudioSearch(prev: {
  room?: string;
  auto?: true;
}): StudioSearch {
  return {
    room: typeof prev.room === 'string' && prev.room ? prev.room : 'main',
    ...(prev.auto ? { auto: true as const } : {}),
  };
}

/** Live drops `auto` — join already happened. */
export function liveStudioSearch(prev: { room?: string }): Pick<StudioSearch, 'room'> {
  return {
    room: typeof prev.room === 'string' && prev.room ? prev.room : 'main',
  };
}
