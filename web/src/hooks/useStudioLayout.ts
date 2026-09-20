import { useEffect, useMemo, useRef, useState } from 'react';
import { sourceId, type CameraPreset, type LayoutState } from '@streaming/canvas-compositor';
import type { RemotePeer } from '@streaming/sfu-client';
import { apiFetch, kickRoomMember, setRoomMemberScene } from '../lib/auth';
import {
  ROOM_CAPACITY,
  SCENE_CAPACITY,
  type RoomParticipant,
  type RoomShareState,
  type RoomSnapshot,
} from '../lib/roomState';

const DEFAULT_LAYOUT: LayoutState = {
  cameraPreset: 'focus',
  featuredId: null,
  sceneScreenIds: [],
};

/** Stable empty roster so memo deps do not churn before the first snapshot. */
const NO_PARTICIPANTS: RoomParticipant[] = [];

/** How often a non-owner speaker re-reads the owner's scene from the API. */
const LAYOUT_POLL_MS = 1_200;

/**
 * Sources visible to *this* client, in the order the preview expects: local camera
 * first (so "auto-feature me" stays the stopgap), then remotes in arrival order.
 */
function visibleSources(
  localPeerId: string | null,
  localStream: MediaStream | null,
  localScreenStream: MediaStream | null,
  remotePeers: RemotePeer[],
): { cameras: string[]; screens: string[] } {
  const cameras: string[] = [];
  const screens: string[] = [];
  if (localPeerId && localStream) cameras.push(sourceId(localPeerId, 'camera'));
  if (localPeerId && localScreenStream) screens.push(sourceId(localPeerId, 'screen'));
  for (const peer of remotePeers) {
    cameras.push(sourceId(peer.id, 'camera'));
    if (peer.screenStream) screens.push(sourceId(peer.id, 'screen'));
  }
  return { cameras, screens };
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function sameOptionalIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameIds(a, b);
}

function sameLayout(a: LayoutState, b: LayoutState): boolean {
  return (
    a.cameraPreset === b.cameraPreset &&
    a.featuredId === b.featuredId &&
    sameIds(a.sceneScreenIds, b.sceneScreenIds) &&
    sameOptionalIds(a.sceneCameraIds, b.sceneCameraIds)
  );
}

/** Match a room participant to the SFU peer that carries their media. */
function peerForParticipant(
  participant: RoomParticipant,
  remotePeers: RemotePeer[],
): RemotePeer | undefined {
  return (
    remotePeers.find((peer) => participant.userId && peer.userId === participant.userId) ??
    remotePeers.find(
      (peer) => participant.displayName !== null && peer.name === participant.displayName,
    )
  );
}

function sameSharing(a: RoomShareState, b: RoomShareState): boolean {
  return (
    a.active === b.active &&
    a.live === b.live &&
    a.status === b.status &&
    a.error === b.error &&
    sameIds(a.destinations, b.destinations)
  );
}

function sameParticipants(a: RoomParticipant[], b: RoomParticipant[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((participant, index) => {
    const other = b[index];
    return (
      participant.id === other.id &&
      participant.inScene === other.inScene &&
      participant.displayName === other.displayName &&
      participant.role === other.role
    );
  });
}

/**
 * Turn a failed owner participant mutation into an actionable message. The
 * server caps membership (15) and program cameras (10); a raw 409 body would
 * otherwise reach the roster as "scene is full" with no next step.
 */
function participantActionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Request failed';
  const lower = message.toLowerCase();
  if (lower.includes('scene is full')) {
    return `Scene is full (${SCENE_CAPACITY}/${SCENE_CAPACITY}). Take someone off the program before adding another camera.`;
  }
  if (lower.includes('room is full')) {
    return `Stream is full (${ROOM_CAPACITY}/${ROOM_CAPACITY}). Remove someone before adding another member.`;
  }
  return message;
}

/** Identity guard so the 1.2s poll does not re-render the studio when nothing changed. */
function sameSnapshot(a: RoomSnapshot, b: RoomSnapshot): boolean {
  return (
    a.room.status === b.room.status &&
    sameLayout(a.layout, b.layout) &&
    sameSharing(a.sharing, b.sharing) &&
    sameParticipants(a.participants, b.participants)
  );
}

/**
 * Turn a *desired* layout into one this client can actually draw.
 *
 * Layout ids are `<peerId>:<kind>` and peer ids come from the SFU, so the owner's
 * choices mean the same thing on every client. They can still reference a source
 * that hasn't reached this browser yet (a peer still connecting, a share that just
 * dropped), so fall back instead of rendering an empty scene.
 */
export function resolveLayout(
  desired: LayoutState,
  cameras: string[],
  screens: string[],
  autoFeature: string | null,
): LayoutState {
  // `sceneCameraIds` undefined is legacy "every live camera on program"; an array
  // (even []) is authoritative and gates off-scene cameras to Sources only.
  const sceneCameraIds =
    desired.sceneCameraIds === undefined
      ? undefined
      : desired.sceneCameraIds.filter((id) => cameras.includes(id));
  const programCameras = sceneCameraIds ?? cameras;
  let featuredId = desired.featuredId;
  if (!featuredId || !programCameras.includes(featuredId)) {
    featuredId =
      autoFeature && programCameras.includes(autoFeature)
        ? autoFeature
        : [...programCameras].sort((a, b) => a.localeCompare(b))[0] ?? null;
  }
  return {
    cameraPreset: desired.cameraPreset,
    featuredId,
    sceneScreenIds: desired.sceneScreenIds.filter((id) => screens.includes(id)),
    ...(sceneCameraIds !== undefined ? { sceneCameraIds } : {}),
  };
}

type UseStudioLayoutArgs = {
  room: string;
  isOwner: boolean;
  joined: boolean;
  localPeerId: string | null;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
};

/**
 * Scene state for the studio.
 *
 * The room owner edits it and pushes it to the API (which stores it and feeds the
 * compositor). Everyone else has read-only controls and mirrors the stored layout,
 * so their program preview follows the host instead of showing only themselves.
 *
 * `layout` is the *resolved* scene this browser can draw; the owner persists the
 * raw desired scene so a temporarily missing source never rewrites the room.
 */
export function useStudioLayout({
  room,
  isOwner,
  joined,
  localPeerId,
  localStream,
  localScreenStream,
  remotePeers,
}: UseStudioLayoutArgs) {
  // Owner's raw edits. Non-owners never touch this.
  const [ownerLayout, setOwnerLayout] = useState<LayoutState>(DEFAULT_LAYOUT);
  // Last scene read back from the API (non-owners only).
  const [sharedLayout, setSharedLayout] = useState<LayoutState | null>(null);
  // Authoritative snapshot (scene + participants + sharing) from the API.
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  // The owner must read the stored scene before publishing, or a reconnect would
  // overwrite the room with the default/fallback scene.
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  // Owner participant moderation: which member is mid-request and the last error.
  const [participantPendingId, setParticipantPendingId] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState('');

  const { cameras, screens } = useMemo(
    () => visibleSources(localPeerId, localStream, localScreenStream, remotePeers),
    [localPeerId, localStream, localScreenStream, remotePeers],
  );
  const autoFeature = localPeerId && localStream ? sourceId(localPeerId, 'camera') : null;
  const participants = snapshot?.participants ?? NO_PARTICIPANTS;

  /**
   * Owner program cameras: the owner's own camera always, plus every participant
   * the owner has placed in scene, mapped to the SFU peer carrying their media
   * (by userId, then display name). Off-scene members keep publishing and stay in
   * Sources; they are simply not composited. Non-owners mirror the stored array.
   *
   * Identity is stabilized so peer track churn does not re-POST an identical scene.
   */
  const ownerSceneCameraIdsRef = useRef<string[]>([]);
  const ownerSceneCameraIds = useMemo<string[] | undefined>(() => {
    if (!isOwner) return undefined;
    const next: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        next.push(id);
      }
    };
    if (autoFeature) add(autoFeature);
    for (const participant of participants) {
      if (!participant.inScene || participant.role === 'owner') continue;
      const peer = peerForParticipant(participant, remotePeers);
      if (peer) add(sourceId(peer.id, 'camera'));
    }
    const prev = ownerSceneCameraIdsRef.current;
    if (sameIds(prev, next)) return prev;
    ownerSceneCameraIdsRef.current = next;
    return next;
  }, [isOwner, autoFeature, participants, remotePeers]);

  const desiredRef = useRef<LayoutState>(DEFAULT_LAYOUT);
  const desired = useMemo<LayoutState>(() => {
    const next = isOwner
      ? { ...ownerLayout, sceneCameraIds: ownerSceneCameraIds }
      : (sharedLayout ?? DEFAULT_LAYOUT);
    const prev = desiredRef.current;
    if (sameLayout(prev, next)) return prev;
    desiredRef.current = next;
    return next;
  }, [isOwner, ownerLayout, ownerSceneCameraIds, sharedLayout]);

  // Keep object identity stable when nothing changed: peers re-emit on every
  // track add/remove and the preview re-runs its layout effect on identity change.
  const layoutRef = useRef<LayoutState>(DEFAULT_LAYOUT);
  const layout = useMemo(() => {
    const next = resolveLayout(desired, cameras, screens, autoFeature);
    const prev = layoutRef.current;
    if (sameLayout(prev, next)) return prev;
    layoutRef.current = next;
    return next;
  }, [desired, cameras, screens, autoFeature]);

  // Owner: publish the raw scene on every change (persisted server-side + forwarded
  // to the recorder). Wait for hydration so a reconnect does not clobber it.
  useEffect(() => {
    if (!joined || !isOwner || !hydrated) return;
    void apiFetch(`/api/rooms/${encodeURIComponent(room)}/layout`, {
      method: 'POST',
      body: JSON.stringify({
        cameraPreset: ownerLayout.cameraPreset,
        featuredId: ownerLayout.featuredId,
        sceneScreenIds: ownerLayout.sceneScreenIds,
        sceneCameraIds: ownerSceneCameraIds,
      }),
    }).catch((err: unknown) => {
      console.warn('[layout] failed to sync recorder', err);
    });
  }, [joined, isOwner, hydrated, ownerLayout, ownerSceneCameraIds, room]);

  // Leaving the session clears state, so the next join (possibly in another
  // room) starts fresh instead of carrying a stale featured id.
  useEffect(() => {
    if (joined) return;
    hydratedRef.current = false;
    ownerSceneCameraIdsRef.current = [];
    setHydrated(false);
    setSnapshot(null);
    setOwnerLayout(DEFAULT_LAYOUT);
    setSharedLayout(null);
    setParticipantPendingId(null);
    setParticipantError('');
  }, [joined]);

  // Everyone: mirror the authoritative room snapshot. Owners hydrate their local
  // scene exactly once and keep their edits; non-owners follow it continuously.
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    let warned = false;
    const pull = async () => {
      try {
        const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/state`);
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as RoomSnapshot;
        if (cancelled) return;
        warned = false;
        setSnapshot((prev) => (prev && sameSnapshot(prev, next) ? prev : next));
        if (isOwner) {
          if (!hydratedRef.current) {
            hydratedRef.current = true;
            // Hydrate the stored scene, unless the owner already made an edit.
            setOwnerLayout((prev) => (sameLayout(prev, DEFAULT_LAYOUT) ? next.layout : prev));
            setHydrated(true);
          }
        } else {
          setSharedLayout((prev) => (prev && sameLayout(prev, next.layout) ? prev : next.layout));
        }
      } catch (err) {
        // One line per outage: this runs on a timer and must not flood the console.
        if (!warned) {
          warned = true;
          console.warn('[layout] failed to follow room state', err);
        }
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), LAYOUT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [joined, isOwner, room]);

  const setCameraPreset = (cameraPreset: CameraPreset) => {
    if (!isOwner) return;
    setOwnerLayout((prev) =>
      prev.cameraPreset === cameraPreset ? prev : { ...prev, cameraPreset },
    );
  };

  const toggleSceneScreen = (id: string) => {
    if (!isOwner) return;
    setOwnerLayout((prev) => {
      const has = prev.sceneScreenIds.includes(id);
      const sceneScreenIds = has
        ? prev.sceneScreenIds.filter((screenId) => screenId !== id)
        : [...prev.sceneScreenIds, id];
      return { ...prev, sceneScreenIds };
    });
  };

  /**
   * Owner-only participant moderation. The mutation updates the local snapshot
   * optimistically so the tiles react immediately; the 1.2s poll then reconciles
   * with the server's authoritative state.
   */
  const mutateParticipant = (
    memberId: string,
    run: () => Promise<void>,
    apply: (prev: RoomSnapshot) => RoomSnapshot,
    onSuccess?: () => void,
  ) => {
    if (!isOwner) return;
    setParticipantPendingId(memberId);
    setParticipantError('');
    void (async () => {
      try {
        await run();
        setSnapshot((prev) => (prev ? apply(prev) : prev));
        onSuccess?.();
      } catch (err) {
        setParticipantError(participantActionMessage(err));
      } finally {
        setParticipantPendingId(null);
      }
    })();
  };

  /**
   * Owner-only: put a participant's camera on the program or take it off, the
   * same gesture as toggling a shared screen. Scene membership gates nothing
   * server-side beyond the program camera cap and the stored roster flag; the
   * featured camera follows so the program preview (and the recorder) updates.
   */
  const toggleParticipantScene = (
    memberId: string,
    cameraSourceId: string,
    inScene: boolean,
  ) => {
    mutateParticipant(
      memberId,
      () => setRoomMemberScene(room, memberId, inScene).then(() => undefined),
      (prev) => ({
        ...prev,
        participants: prev.participants.map((participant) =>
          participant.id === memberId ? { ...participant, inScene } : participant,
        ),
      }),
      () => {
        setOwnerLayout((prev) => {
          if (inScene) {
            return prev.featuredId === cameraSourceId
              ? prev
              : { ...prev, featuredId: cameraSourceId };
          }
          return prev.featuredId === cameraSourceId ? { ...prev, featuredId: null } : prev;
        });
      },
    );
  };

  const kickParticipant = (memberId: string) => {
    mutateParticipant(
      memberId,
      () => kickRoomMember(room, memberId),
      (prev) => ({
        ...prev,
        participants: prev.participants.filter((participant) => participant.id !== memberId),
      }),
    );
  };

  return {
    layout,
    setCameraPreset,
    toggleSceneScreen,
    // Resolved program cameras; legacy layouts (undefined) put every live camera
    // on program, so expose the full available list for the Sources marker.
    sceneCameraIds: layout.sceneCameraIds ?? cameras,
    sharing: snapshot?.sharing ?? null,
    participants,
    participantPendingId,
    participantError,
    toggleParticipantScene,
    kickParticipant,
  };
}
