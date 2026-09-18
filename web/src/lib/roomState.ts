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
    /** Program cameras; omitted by legacy rooms means every live camera. */
    sceneCameraIds?: string[];
  };
  participants: RoomParticipant[];
  sharing: RoomShareState;
};

/** Server-enforced scene cap: at most this many members may be on scene. */
export const SCENE_CAPACITY = 10;
/** Server-enforced room cap: at most this many members may belong to a room. */
export const ROOM_CAPACITY = 15;

export function participantName(participant: RoomParticipant): string {
  return participant.displayName?.trim() || 'Member';
}
