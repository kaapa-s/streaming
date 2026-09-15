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
    // Diagnostics: if a peer is missing here (or shows 0 audio tracks) the problem is
    // upstream in signaling/consume, not the playback. See also '[sfu] consume failed'.
    console.debug(
      '[remote-audio] playing',
      remotePeers.map((p) => `${p.name}#${p.id.slice(0, 8)}:${p.stream.getAudioTracks().length}`),
    );
    player.setPeers(remotePeers);
  }, [joined, remotePeers]);

  useEffect(() => {
    return () => {
      remoteAudioRef.current?.stop();
      remoteAudioRef.current = null;
    };
  }, []);
}
