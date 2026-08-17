import type { RemotePeer } from '@streaming/sfu-client';
import { Monitor } from 'lucide-react';
import { useState } from 'react';
import { VideoTile } from './VideoTile';

export type LayoutPreset = 'focus' | 'pip-left' | 'pip-right' | 'grid';

const LAYOUTS: { id: LayoutPreset; label: string }[] = [
  { id: 'focus', label: 'focus' },
  { id: 'pip-left', label: 'pip L' },
  { id: 'pip-right', label: 'pip R' },
  { id: 'grid', label: 'grid' },
];

type SceneStripProps = {
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
  screenPending: boolean;
  onToggleScreenShare: () => void;
};

export function SceneStrip({
  localStream,
  localScreenStream,
  remotePeers,
  screenPending,
  onToggleScreenShare,
}: SceneStripProps) {
  const [layout, setLayout] = useState<LayoutPreset>('focus');

  return (
    <section className="border-t border-border bg-surface-raised px-5 py-4">
      <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle mb-3">
        Scene
      </h2>

      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-ink-muted mb-2">Layout</p>
          <div className="flex flex-wrap gap-2">
            {LAYOUTS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLayout(item.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  layout === item.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-surface text-ink-muted hover:text-ink'
                }`}
              >
                {item.label}
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
              disabled={screenPending}
              className={`relative overflow-hidden rounded-lg aspect-video w-[140px] flex flex-col items-center justify-center gap-1.5 border-2 border-dashed transition-colors disabled:opacity-50 ${
                localScreenStream
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface-muted text-ink-muted hover:border-accent hover:text-accent'
              }`}
            >
              <Monitor size={20} strokeWidth={1.5} />
              <span className="text-[11px] font-semibold leading-tight">
                {localScreenStream ? 'Stop sharing' : 'Share screen'}
              </span>
            </button>
            {localStream && (
              <VideoTile
                stream={localStream}
                label="You"
                sharing={!!localScreenStream}
              />
            )}
            {remotePeers.map((peer) => (
              <VideoTile key={peer.id} stream={peer.stream} label={peer.name} />
            ))}
            {localScreenStream && (
              <VideoTile stream={localScreenStream} label="Screen share" />
            )}
            {remotePeers.map((peer) =>
              peer.screenStream ? (
                <VideoTile
                  key={`${peer.id}-screen`}
                  stream={peer.screenStream}
                  label={`${peer.name} screen`}
                />
              ) : null,
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
