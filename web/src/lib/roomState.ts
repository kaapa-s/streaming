/**
 * Authoritative room state shared by the API and every connected studio.
 * Mirrors the member-scoped `GET /rooms/:slug/state` response.
 */
export type RoomShareState = {
  /** A media session (recording or live) is starting/recording. */
  active: boolean;
  live: boolean;
  status: string | null;
  startedAt: string | null;
  destinations: string[];
  error: string | null;
};

export type RoomParticipant = {
  id: string;
  userId: string | null;
  guestId: string | null;
  displayName: string | null;
  role: 'owner' | 'speaker' | 'viewer';
  inScene: boolean;
};

export type RoomSnapshot = {
  room: { id: string; slug: string; name: string; status: 'created' | 'active' | 'finished' };
  role: 'owner' | 'speaker' | 'viewer';
  layout: {
    cameraPreset: 'focus' | 'pip-left' | 'pip-right' | 'grid';
    featuredId: string | null;
    sceneScreenIds: string[];
  };
  participants: RoomParticipant[];
  sharing: RoomShareState;
};

export function participantName(participant: RoomParticipant): string {
  return participant.displayName?.trim() || (participant.guestId ? 'Guest' : 'Member');
}
