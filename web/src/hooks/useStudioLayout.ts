import { useEffect, useState } from 'react';
import { sourceId, type CameraPreset, type LayoutState } from '@streaming/canvas-compositor';
import type { RemotePeer } from '@streaming/sfu-client';
import { apiFetch } from '../lib/auth';

const DEFAULT_LAYOUT: LayoutState = { cameraPreset: 'focus', featuredId: null, sceneScreenIds: [] };

function cameraSourceIds(
  localPeerId: string | null,
  localStream: MediaStream | null,
  remotePeers: RemotePeer[],
): string[] {
  const ids: string[] = [];
  if (localPeerId && localStream) ids.push(sourceId(localPeerId, 'camera'));
  for (const peer of remotePeers) ids.push(sourceId(peer.id, 'camera'));
  return ids;
}

function liveScreenIds(
  localPeerId: string | null,
  localScreenStream: MediaStream | null,
  remotePeers: RemotePeer[],
): string[] {
  const ids: string[] = [];
  if (localPeerId && localScreenStream) ids.push(sourceId(localPeerId, 'screen'));
  for (const peer of remotePeers) {
    if (peer.screenStream) ids.push(sourceId(peer.id, 'screen'));
  }
  return ids;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

type UseStudioLayoutArgs = {
  room: string | null;
  isOwner: boolean;
  joined: boolean;
  localPeerId: string | null;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
};

export function useStudioLayout({
  room,
  isOwner,
  joined,
  localPeerId,
  localStream,
  localScreenStream,
  remotePeers,
}: UseStudioLayoutArgs) {
  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT);

  useEffect(() => {
    if (!joined) {
      setLayout(DEFAULT_LAYOUT);
      return;
    }
    const cameras = cameraSourceIds(localPeerId, localStream, remotePeers);
    const screens = liveScreenIds(localPeerId, localScreenStream, remotePeers);
    setLayout((prev) => {
      const sceneScreenIds = prev.sceneScreenIds.filter((id) => screens.includes(id));
      let featuredId = prev.featuredId;
      if (!featuredId || !cameras.includes(featuredId)) {
        const ownerCamera = localPeerId ? sourceId(localPeerId, 'camera') : null;
        featuredId =
          ownerCamera && cameras.includes(ownerCamera)
            ? ownerCamera
            : [...cameras].sort((a, b) => a.localeCompare(b))[0] ?? null;
      }
      if (featuredId === prev.featuredId && sameIds(sceneScreenIds, prev.sceneScreenIds)) {
        return prev;
      }
      return { ...prev, featuredId, sceneScreenIds };
    });
  }, [joined, localPeerId, localStream, localScreenStream, remotePeers]);

  useEffect(() => {
    if (!joined || !isOwner || !room) return;
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

  const setCameraPreset = (cameraPreset: CameraPreset) => {
    if (!isOwner) return;
    setLayout((prev) => (prev.cameraPreset === cameraPreset ? prev : { ...prev, cameraPreset }));
  };

  const setFeatured = (featuredId: string) => {
    if (!isOwner) return;
    setLayout((prev) => (prev.featuredId === featuredId ? prev : { ...prev, featuredId }));
  };

  const toggleSceneScreen = (id: string) => {
    if (!isOwner) return;
    setLayout((prev) => {
      const has = prev.sceneScreenIds.includes(id);
      const sceneScreenIds = has
        ? prev.sceneScreenIds.filter((screenId) => screenId !== id)
        : [...prev.sceneScreenIds, id];
      return { ...prev, sceneScreenIds };
    });
  };

  return { layout, setCameraPreset, setFeatured, toggleSceneScreen };
}
