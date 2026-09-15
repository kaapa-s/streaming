import { sourceId, type CameraPreset } from '@streaming/canvas-compositor';
import type { RemotePeer } from '@streaming/sfu-client';
import { Monitor } from 'lucide-react';
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
  cameraPreset: CameraPreset;
  featuredId: string | null;
  sceneScreenIds: string[];
  canEditLayout: boolean;
  /** Owner only — removes someone from the room for good. */
  onRemovePeer?: (userId: string) => void;
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
  cameraPreset,
  featuredId,
  sceneScreenIds,
  canEditLayout,
  onRemovePeer,
  onCameraPreset,
  onFeature,
  onToggleSceneScreen,
}: SceneStripProps) {
  const localCameraId = localPeerId ? sourceId(localPeerId, 'camera') : null;
  const localScreenId = localPeerId ? sourceId(localPeerId, 'screen') : null;

  return (
    <section className="border-t border-border bg-surface-raised px-5 py-4">
      <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle mb-3">
        Scene
      </h2>

      <div className="flex flex-col gap-4">
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
              const userId = peer.userId;
              return (
                <VideoTile
                  key={peer.id}
                  stream={peer.stream}
                  label={peer.name}
                  selected={featuredId === cameraId}
                  onSelect={canEditLayout ? () => onFeature(cameraId) : undefined}
                  onRemove={
                    onRemovePeer && userId
                      ? () => {
                          if (window.confirm(`Remove ${peer.name} from this room?`)) {
                            onRemovePeer(userId);
                          }
                        }
                      : undefined
                  }
                  removeTitle="Remove from room"
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
