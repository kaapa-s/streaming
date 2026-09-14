import { useEffect, useRef } from 'react';
import type { RemotePeer } from '@streaming/sfu-client';
import { createRemoteAudioPlayer, type RemoteAudioPlayer } from '../lib/remoteAudio';

type UseRemoteAudioOpts = {
  localPeerId: string | null;
  localUserId: string | null;
  localAudioTrackIds: string[];
};

/** Plays remote mics only — never pass the local stream (feedback loop). */
export function useRemoteAudio(
  joined: boolean,
  remotePeers: RemotePeer[],
  { localPeerId, localUserId, localAudioTrackIds }: UseRemoteAudioOpts,
) {
  const remoteAudioRef = useRef<RemoteAudioPlayer | null>(null);

  useEffect(() => {
    if (!joined) {
      remoteAudioRef.current?.stop();
      remoteAudioRef.current = null;
      return;
    }
    const player = remoteAudioRef.current ?? createRemoteAudioPlayer();
    remoteAudioRef.current = player;
    player.setPeers(
      remotePeers.filter((peer) => {
        if (peer.id === localPeerId) return false;
        if (localUserId && peer.userId === localUserId) return false;
        return true;
      }),
      localAudioTrackIds,
    );
  }, [joined, remotePeers, localPeerId, localUserId, localAudioTrackIds]);

  useEffect(() => {
    return () => {
      remoteAudioRef.current?.stop();
      remoteAudioRef.current = null;
    };
  }, []);
}
