import { sourceId, type CameraPreset } from '@streaming/canvas-compositor';
import type { RemotePeer } from '@streaming/sfu-client';
import { useEffect, useState } from 'react';
import {
  ROOM_CAPACITY,
  SCENE_CAPACITY,
  participantName,
  type RoomParticipant,
} from '../../lib/roomState';
import { KickParticipantModal } from './KickParticipantModal';
import { LAYOUT_OPTIONS } from './layoutIcons';
import { VideoTile } from './VideoTile';

type SceneStripProps = {
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localPeerId: string | null;
  remotePeers: RemotePeer[];
  screenPending: boolean;
  onRemoveLocalScreen: () => void;
  cameraPreset: CameraPreset;
  sceneScreenIds: string[];
  /** Resolved camera sources currently on the program (owner's scene). */
  sceneCameraIds: string[];
  canEditLayout: boolean;
  participants: RoomParticipant[];
  participantPendingId: string | null;
  participantError: string;
  onToggleParticipantScene: (memberId: string, cameraSourceId: string, inScene: boolean) => void;
  onKickParticipant: (memberId: string) => void;
  onCameraPreset: (preset: CameraPreset) => void;
  onToggleSceneScreen: (sourceId: string) => void;
};

export function SceneStrip({
  localStream,
  localScreenStream,
  localPeerId,
  remotePeers,
  screenPending,
  onRemoveLocalScreen,
  cameraPreset,
  sceneScreenIds,
  sceneCameraIds,
  canEditLayout,
  participants,
  participantPendingId,
  participantError,
  onToggleParticipantScene,
  onKickParticipant,
  onCameraPreset,
  onToggleSceneScreen,
}: SceneStripProps) {
  const localScreenId = localPeerId ? sourceId(localPeerId, 'screen') : null;
  const [kickTarget, setKickTarget] = useState<RoomParticipant | null>(null);

  // Close the confirmation once the kicked member leaves the roster. A failed
  // kick keeps the modal open with the server's error.
  useEffect(() => {
    if (kickTarget && !participants.some((participant) => participant.id === kickTarget.id)) {
      setKickTarget(null);
    }
  }, [kickTarget, participants]);

  /** Match a room member to the stream that arrived from their SFU peer. */
  const peerForParticipant = (participant: RoomParticipant): RemotePeer | undefined =>
    remotePeers.find((peer) => participant.userId && peer.userId === participant.userId) ??
    remotePeers.find(
      (peer) => participant.displayName !== null && peer.name === participant.displayName,
    );

  // Owner view: one camera tile per member from the authoritative roster, so a
  // participant is kickable as soon as membership is known. A member whose media
  // has not arrived yet gets a labelled placeholder that still carries the X.
  // Off-scene cameras stay live in Sources; only the marker changes.
  const managedPeerIds = new Set<string>();
  const ownerCameraTiles = canEditLayout
    ? participants
        .filter((participant) => participant.role !== 'owner')
        .map((participant) => {
          const peer = peerForParticipant(participant);
          if (peer) managedPeerIds.add(peer.id);
          const cameraId = peer ? sourceId(peer.id, 'camera') : null;
          const inScene = participant.inScene;
          return (
            <VideoTile
              key={participant.id}
              stream={peer?.stream ?? null}
              label={participantName(participant)}
              waiting={!inScene}
              selected={cameraId ? sceneCameraIds.includes(cameraId) : inScene}
              onSelect={
                cameraId
                  ? () => onToggleParticipantScene(participant.id, cameraId, !inScene)
                  : undefined
              }
              onRemove={() => setKickTarget(participant)}
            />
          );
        })
    : null;

  // A peer can connect a beat before its roster row arrives. Render a live,
  // read-only preview so no connected camera is ever missing from Sources.
  const unmanagedCameraTiles = canEditLayout
    ? remotePeers
        .filter((peer) => !managedPeerIds.has(peer.id))
        .map((peer) => (
          <VideoTile
            key={peer.id}
            stream={peer.stream}
            label={peer.name}
            selected={sceneCameraIds.includes(sourceId(peer.id, 'camera'))}
          />
        ))
    : null;

  // Viewer view: remote media is display-only (mirrors the owner's program).
  const viewerCameraTiles = canEditLayout
    ? null
    : remotePeers.map((peer) => (
        <VideoTile
          key={peer.id}
          stream={peer.stream}
          label={peer.name}
          selected={sceneCameraIds.includes(sourceId(peer.id, 'camera'))}
        />
      ));

  return (
    <section className="border-t border-border bg-surface-raised px-5 py-4">
      <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle mb-3 flex items-baseline gap-2.5">
        Scene
        {!canEditLayout && (
          <span className="normal-case tracking-normal text-[11px] font-medium text-ink-muted">
            Following the host — their layout drives your preview and the stream.
          </span>
        )}
      </h2>

      <div className="flex flex-col gap-4">
        {canEditLayout && (
          <div>
            <p className="text-xs font-medium text-ink-muted mb-2">Layout</p>
            <div className="flex flex-wrap gap-2">
              {LAYOUT_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onCameraPreset(item.id)}
                  aria-label={item.label}
                  title={item.label}
                  className={`size-10 inline-flex items-center justify-center rounded-lg border transition-colors ${
                    cameraPreset === item.id
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-surface text-ink-muted hover:text-ink'
                  }`}
                >
                  <item.Icon className="size-5" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-xs font-medium text-ink-muted">Sources</p>
            <p className="text-[11px] text-ink-subtle">
              Scene {participants.filter((participant) => participant.inScene).length}/
              {SCENE_CAPACITY} · Stream {participants.length}/{ROOM_CAPACITY}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {localStream && (
              <VideoTile
                stream={localStream}
                label="You"
                sharing={!!localScreenStream}
              />
            )}
            {ownerCameraTiles}
            {unmanagedCameraTiles}
            {viewerCameraTiles}
            {localScreenStream && localScreenId && (
              <VideoTile
                stream={localScreenStream}
                label="Screen share"
                selected={sceneScreenIds.includes(localScreenId)}
                onSelect={canEditLayout ? () => onToggleSceneScreen(localScreenId) : undefined}
                onRemove={screenPending ? undefined : onRemoveLocalScreen}
              />
            )}
            {remotePeers.map((peer) => {
              if (!peer.screenStream) return null;
              const screenId = sourceId(peer.id, 'screen');
              return (
                <VideoTile
                  key={`${peer.id}-screen`}
                  stream={peer.screenStream}
                  label={`${peer.name} screen`}
                  selected={sceneScreenIds.includes(screenId)}
                  onSelect={canEditLayout ? () => onToggleSceneScreen(screenId) : undefined}
                />
              );
            })}
          </div>
          {participantError && !kickTarget && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs font-medium text-danger"
            >
              {participantError}
            </p>
          )}
        </div>
      </div>

      {kickTarget && (
        <KickParticipantModal
          participantName={participantName(kickTarget)}
          pending={participantPendingId === kickTarget.id}
          error={participantError}
          onCancel={() => setKickTarget(null)}
          onConfirm={() => onKickParticipant(kickTarget.id)}
        />
      )}
    </section>
  );
}
