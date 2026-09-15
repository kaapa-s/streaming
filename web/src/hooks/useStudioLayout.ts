import { useEffect, useMemo, useRef, useState } from 'react';
import { sourceId, type CameraPreset, type LayoutState } from '@streaming/canvas-compositor';
import type { RemotePeer } from '@streaming/sfu-client';
import { apiFetch } from '../lib/auth';

const DEFAULT_LAYOUT: LayoutState = {
  cameraPreset: 'focus',
  featuredId: null,
  sceneScreenIds: [],
};

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

function sameLayout(a: LayoutState, b: LayoutState): boolean {
  return (
    a.cameraPreset === b.cameraPreset &&
    a.featuredId === b.featuredId &&
    sameIds(a.sceneScreenIds, b.sceneScreenIds)
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
  let featuredId = desired.featuredId;
  if (!featuredId || !cameras.includes(featuredId)) {
    featuredId =
      autoFeature && cameras.includes(autoFeature)
        ? autoFeature
        : [...cameras].sort((a, b) => a.localeCompare(b))[0] ?? null;
  }
  return {
    cameraPreset: desired.cameraPreset,
    featuredId,
    sceneScreenIds: desired.sceneScreenIds.filter((id) => screens.includes(id)),
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

  const { cameras, screens } = useMemo(
    () => visibleSources(localPeerId, localStream, localScreenStream, remotePeers),
    [localPeerId, localStream, localScreenStream, remotePeers],
  );
  const autoFeature = localPeerId && localStream ? sourceId(localPeerId, 'camera') : null;
  const desired = isOwner ? ownerLayout : (sharedLayout ?? DEFAULT_LAYOUT);

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

  // Owner: publish every change (persisted server-side + forwarded to the recorder).
  useEffect(() => {
    if (!joined || !isOwner) return;
    void apiFetch(`/api/rooms/${encodeURIComponent(room)}/layout`, {
      method: 'POST',
      body: JSON.stringify({
        cameraPreset: layout.cameraPreset,
        featuredId: layout.featuredId,
        sceneScreenIds: layout.sceneScreenIds,
      }),
    }).catch((err: unknown) => {
      console.warn('[layout] failed to sync recorder', err);
    });
  }, [joined, isOwner, layout, room]);

  // Leaving the session clears the scene, so the next join (possibly in another
  // room) starts from the default instead of carrying a stale featured id.
  useEffect(() => {
    if (joined) return;
    setOwnerLayout(DEFAULT_LAYOUT);
    setSharedLayout(null);
  }, [joined]);

  // Speaker: mirror the owner's scene. Best-effort — a failed poll keeps the last
  // known scene rather than dropping the viewer back to "just me".
  useEffect(() => {
    if (!joined || isOwner) return;
    let cancelled = false;
    let warned = false;
    const pull = async () => {
      try {
        const res = await apiFetch(`/api/rooms/${encodeURIComponent(room)}/layout`);
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as LayoutState;
        if (cancelled) return;
        warned = false;
        setSharedLayout((prev) => (prev && sameLayout(prev, next) ? prev : next));
      } catch (err) {
        // One line per outage: this runs on a timer and must not flood the console.
        if (!warned) {
          warned = true;
          console.warn('[layout] failed to follow host scene', err);
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

  const setFeatured = (featuredId: string) => {
    if (!isOwner) return;
    setOwnerLayout((prev) =>
      prev.featuredId === featuredId ? prev : { ...prev, featuredId },
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

  return { layout, setCameraPreset, setFeatured, toggleSceneScreen };
}
