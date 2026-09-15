/**
 * Room scene state (layout + featured camera + screens in the program).
 *
 * The owner's studio edits this and POSTs it to the API; the API stores it on the
 * room, forwards it to the compositor, and serves it back to everyone else so
 * non-owner speakers see the same program preview the owner sees.
 *
 * Mirrors LayoutState in shared/canvas-compositor (the API must not import DOM code).
 */
export const CAMERA_PRESETS = ['focus', 'pip-left', 'pip-right', 'grid'] as const;

export type CameraPreset = (typeof CAMERA_PRESETS)[number];

export interface RoomLayout {
  cameraPreset: CameraPreset;
  /** Source id (`<peerId>:camera`), or null when nothing is featured yet. */
  featuredId: string | null;
  /** Source ids of screen shares (`<peerId>:screen`) composited into the scene. */
  sceneScreenIds: string[];
}

/** Fresh copy — callers must never share a mutable array with the default. */
export function defaultRoomLayout(): RoomLayout {
  return { cameraPreset: 'focus', featuredId: null, sceneScreenIds: [] };
}

export const DEFAULT_ROOM_LAYOUT: RoomLayout = defaultRoomLayout();

function isCameraPreset(value: unknown): value is CameraPreset {
  return typeof value === 'string' && (CAMERA_PRESETS as readonly string[]).includes(value);
}

/**
 * Coerce whatever came from the client or the jsonb column into a valid layout.
 * Legacy rows (hand-edited, older shape) must never 500 a studio.
 */
export function normalizeRoomLayout(input: unknown): RoomLayout {
  if (typeof input !== 'object' || input === null) return defaultRoomLayout();
  const raw = input as Partial<RoomLayout>;
  const featuredId =
    typeof raw.featuredId === 'string' && raw.featuredId.length > 0 ? raw.featuredId : null;
  const sceneScreenIds = Array.isArray(raw.sceneScreenIds)
    ? raw.sceneScreenIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  return {
    cameraPreset: isCameraPreset(raw.cameraPreset) ? raw.cameraPreset : 'focus',
    featuredId,
    sceneScreenIds,
  };
}
