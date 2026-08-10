import type { RemotePeer } from '@streaming/sfu-client';
import { VideoTile } from './VideoTile';

type SpeakersGridProps = {
  localName: string;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
};

export function SpeakersGrid({
  localName,
  localStream,
  localScreenStream,
  remotePeers,
}: SpeakersGridProps) {
  return (
    <section>
      <h2>Speakers</h2>
      <div className="tiles">
        {localStream && (
          <VideoTile
            stream={localStream}
            label={`${localName} (you)`}
            sharing={!!localScreenStream}
          />
        )}
        {remotePeers.map((peer) => (
          <VideoTile
            key={peer.id}
            stream={peer.stream}
            label={peer.name}
            sharing={!!peer.screenStream}
          />
        ))}
      </div>
    </section>
  );
}
