import { useEffect, useRef } from 'react';
import type { RemotePeer } from '@streaming/sfu-client';
import { createRemoteAudioPlayer, type RemoteAudioPlayer } from '../lib/remoteAudio';

/** Plays remote mics only — never pass the local stream (feedback loop). */
export function useRemoteAudio(joined: boolean, remotePeers: RemotePeer[]) {
  const remoteAudioRef = useRef<RemoteAudioPlayer | null>(null);

  useEffect(() => {
    if (!joined) {
      remoteAudioRef.current?.stop();
      remoteAudioRef.current = null;
      return;
    }
    const player = remoteAudioRef.current ?? createRemoteAudioPlayer();
    remoteAudioRef.current = player;
    player.setPeers(remotePeers);
  }, [joined, remotePeers]);

  useEffect(() => {
    return () => {
      remoteAudioRef.current?.stop();
      remoteAudioRef.current = null;
    };
  }, []);
}
