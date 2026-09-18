import { sourceId, type CameraPreset } from '@streaming/canvas-compositor';
import type { RemotePeer } from '@streaming/sfu-client';
import { Camera, CameraOff, Mic, MicOff, Monitor } from 'lucide-react';
import {
  participantName,
  ROOM_CAPACITY,
  SCENE_CAPACITY,
  type RoomParticipant,
} from '../../lib/roomState';
import { LAYOUT_OPTIONS } from './layoutIcons';
import { VideoTile } from './VideoTile';

type SceneStripProps = {
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localPeerId: string | null;
  remotePeers: RemotePeer[];
  screenPending: boolean;
  onToggleScreenShare: () => void;
  onRemoveLocalScreen: () => void;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  cameraPreset: CameraPreset;
  featuredId: string | null;
  sceneScreenIds: string[];
  canEditLayout: boolean;
  participants: RoomParticipant[];
  participantPendingId: string | null;
  participantError: string;
  onSetParticipantScene: (memberId: string, inScene: boolean) => void;
  onKickParticipant: (memberId: string) => void;
  onCameraPreset: (preset: CameraPreset) => void;
  onFeature: (sourceId: string) => void;
  onToggleSceneScreen: (sourceId: string) => void;
};

export function SceneStrip({
  localStream,
  localScreenStream,
  localPeerId,
  remotePeers,
  screenPending,
  onToggleScreenShare,
  onRemoveLocalScreen,
  onToggleCamera,
  onToggleMicrophone,
  cameraPreset,
  featuredId,
  sceneScreenIds,
  canEditLayout,
  participants,
  participantPendingId,
  participantError,
  onSetParticipantScene,
  onKickParticipant,
  onCameraPreset,
  onFeature,
  onToggleSceneScreen,
}: SceneStripProps) {
  const localCameraId = localPeerId ? sourceId(localPeerId, 'camera') : null;
  const localScreenId = localPeerId ? sourceId(localPeerId, 'screen') : null;

  const onScene = participants.filter((participant) => participant.inScene);
  const offScene = participants.filter((participant) => !participant.inScene);

  const renderParticipant = (participant: RoomParticipant) => {
    // Only the owner moderates, and never themselves (the owner is always on scene).
    const canManage = canEditLayout && participant.role !== 'owner';
    const pending = participantPendingId === participant.id;
    return (
      <li
        key={participant.id}
        className={`flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-[11px] font-medium ${
          participant.inScene ? 'border-accent/40 text-ink' : 'border-border text-ink-subtle'
        }`}
      >
        <span title={participant.inScene ? 'On scene' : 'Waiting for admission'}>
          {participantName(participant)}
          {participant.role === 'owner' ? ' · host' : ''}
        </span>
        {canManage && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => onSetParticipantScene(participant.id, !participant.inScene)}
              title={
                participant.inScene
                  ? 'Remove from the scene (keeps them in the room)'
                  : 'Admit to the scene'
              }
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                participant.inScene
                  ? 'border-border text-ink-muted hover:border-danger hover:text-danger'
                  : 'border-accent text-accent hover:bg-accent/10'
              }`}
            >
              {participant.inScene ? 'Remove' : 'Admit'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    `Kick ${participantName(participant)} from the room? They will be disconnected.`,
                  )
                ) {
                  onKickParticipant(participant.id);
                }
              }}
              title="Kick from the room"
              className="rounded-full border border-danger/50 px-2 py-0.5 text-[10px] font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Kick
            </button>
          </span>
        )}
      </li>
    );
  };

  return (
    <section className="border-t border-border bg-surface-raised px-5 py-4">
      <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle mb-3 flex items-baseline gap-2.5">
        Scene
        {!canEditLayout && (
          <span className="normal-case tracking-normal text-[11px] font-medium text-ink-muted">
            Following the host — their layout drives your preview and the recording.
          </span>
        )}
      </h2>

      {participants.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-[11px] font-medium text-ink-muted">Participants</p>
            <p className="text-[11px] text-ink-subtle">
              Scene {onScene.length}/{SCENE_CAPACITY} · Room {participants.length}/{ROOM_CAPACITY}
            </p>
          </div>
          {onScene.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Participants on scene">
              {onScene.map(renderParticipant)}
            </ul>
          )}
          {offScene.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-ink-muted">
                Waiting to be admitted ({offScene.length})
              </p>
              <ul
                className="flex flex-wrap gap-1.5"
                aria-label="Participants waiting to be admitted"
              >
                {offScene.map(renderParticipant)}
              </ul>
            </div>
          )}
          {participantError && (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs font-medium text-danger"
            >
              {participantError}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {localStream && (
          <div className="flex gap-2">
            <button type="button" onClick={onToggleCamera} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold">
              {localStream.getVideoTracks()[0]?.enabled ? <Camera size={16} /> : <CameraOff size={16} />}
              Camera
            </button>
            <button type="button" onClick={onToggleMicrophone} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold">
              {localStream.getAudioTracks()[0]?.enabled ? <Mic size={16} /> : <MicOff size={16} />}
              Microphone
            </button>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-ink-muted mb-2">Layout</p>
          <div className="flex flex-wrap gap-2">
            {LAYOUT_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!canEditLayout}
                onClick={() => onCameraPreset(item.id)}
                aria-label={item.label}
                title={item.label}
                className={`size-10 inline-flex items-center justify-center rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  cameraPreset === item.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-surface text-ink-muted hover:text-ink disabled:hover:text-ink-muted'
                }`}
              >
                <item.Icon className="size-5" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-muted mb-2">Sources</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onToggleScreenShare}
              disabled={screenPending || !!localScreenStream}
              className="relative overflow-hidden rounded-lg aspect-video w-[140px] flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-border bg-surface-muted text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-border disabled:hover:text-ink-muted"
            >
              <Monitor size={20} strokeWidth={1.5} />
              <span className="text-[11px] font-semibold leading-tight">Share screen</span>
            </button>
            {localStream && (
              <VideoTile
                stream={localStream}
                label="You"
                sharing={!!localScreenStream}
                selected={localCameraId !== null && featuredId === localCameraId}
                onSelect={
                  canEditLayout && localCameraId
                    ? () => onFeature(localCameraId)
                    : undefined
                }
              />
            )}
            {remotePeers.map((peer) => {
              const cameraId = sourceId(peer.id, 'camera');
              return (
                <VideoTile
                  key={peer.id}
                  stream={peer.stream}
                  label={peer.name}
                  selected={featuredId === cameraId}
                  onSelect={canEditLayout ? () => onFeature(cameraId) : undefined}
                />
              );
            })}
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
        </div>
      </div>
    </section>
  );
}
