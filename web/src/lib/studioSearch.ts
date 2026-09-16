/** Shared search params for studio routes (`room`, optional `auto` for e2e). */
export type StudioSearch = {
  room: string;
  invite?: string;
  auto?: true;
  e2eDiagnostics?: true;
};

export function parseStudioSearch(search: Record<string, unknown>): StudioSearch {
  return {
    room: typeof search.room === 'string' ? search.room : '',
    invite: typeof search.invite === 'string' ? search.invite : '',
    ...(search.auto === '1' || search.auto === true ? { auto: true as const } : {}),
    ...(search.e2eDiagnostics === '1' || search.e2eDiagnostics === true ? { e2eDiagnostics: true as const } : {}),
  };
}

/** Keep `room` / `auto` across studio navigations (redirect search reducer). */
export function keepStudioSearch(prev: {
  room?: string;
  invite?: string;
  auto?: true;
  e2eDiagnostics?: true;
}): StudioSearch {
  return {
    room: typeof prev.room === 'string' ? prev.room : '',
    invite: typeof prev.invite === 'string' ? prev.invite : '',
    ...(prev.auto ? { auto: true as const } : {}),
    ...(prev.e2eDiagnostics ? { e2eDiagnostics: true as const } : {}),
  };
}

/** Live drops `auto` — join already happened. */
export function liveStudioSearch(prev: { room?: string; invite?: string; e2eDiagnostics?: true }): Pick<StudioSearch, 'room' | 'invite' | 'e2eDiagnostics'> {
  return {
    room: typeof prev.room === 'string' ? prev.room : '',
    invite: typeof prev.invite === 'string' ? prev.invite : '',
    ...(prev.e2eDiagnostics ? { e2eDiagnostics: true as const } : {}),
  };
}
