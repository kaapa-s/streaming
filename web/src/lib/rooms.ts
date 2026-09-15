import { apiFetch, parseApiError } from './auth';

export type RoomRole = 'owner' | 'speaker' | 'viewer';

export interface JoinedRoom {
  room: { id: string; slug: string; title: string; ownerId: string };
  role: RoomRole;
  joinToken: string;
  sfuUrl?: string;
}

export interface RoomDescription {
  slug: string;
  title: string;
  ownerName: string;
  closed: boolean;
  youAreOwner: boolean;
  youAreRemoved: boolean;
}

/** Creates one room for one stream. The slug comes back server-minted. */
export async function createRoom(title: string): Promise<{
  id: string;
  slug: string;
  title: string;
}> {
  const res = await apiFetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

/** What the pre-join screen shows. Membership is not required to read this. */
export async function getRoom(slug: string): Promise<RoomDescription> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export async function joinRoom(slug: string): Promise<JoinedRoom> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}/join`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

/**
 * Durable half of a kick. Must land before the signaling kick — otherwise the
 * target reconnects with a fresh token before the row is marked.
 */
export async function removeMember(slug: string, userId: string): Promise<void> {
  const res = await apiFetch(
    `/api/rooms/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(await parseApiError(res));
}

/** Ends the stream: closes the room, stops any recording, frees the compositor slot. */
export async function endRoom(slug: string): Promise<{ stopped: boolean; downloadUrl?: string }> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(slug)}/end`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}
