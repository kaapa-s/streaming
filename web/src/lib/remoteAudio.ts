/**
 * Plays remote participants' mic tracks through the local speakers.
 *
 * Intentionally separate from video tiles / the compositor: those must stay
 * video-only so the local mic can never loop back into the speakers.
 * Never pass the local getUserMedia stream here.
 */
export interface RemoteAudioPeer {
  id: string;
  stream: MediaStream;
}

export interface RemoteAudioPlayer {
  setPeers: (peers: RemoteAudioPeer[]) => void;
  stop: () => void;
}

function trackFingerprint(tracks: MediaStreamTrack[]): string {
  return tracks.map((t) => t.id).join(',');
}

export function createRemoteAudioPlayer(): RemoteAudioPlayer {
  const elements = new Map<string, HTMLAudioElement>();
  const listeners = new Map<string, { stream: MediaStream; onChange: () => void }>();

  const bind = (id: string, stream: MediaStream) => {
    let audio = elements.get(id);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      elements.set(id, audio);
    }

    const tracks = stream.getAudioTracks().filter((t) => t.readyState !== 'ended');
    const prev = audio.srcObject;
    if (prev instanceof MediaStream) {
      if (trackFingerprint(prev.getAudioTracks()) === trackFingerprint(tracks)) {
        if (tracks.length > 0 && audio.paused) {
          void audio.play().catch((err: unknown) => {
            console.warn('[remote-audio] play failed', id, err);
          });
        }
        return;
      }
    }

    audio.srcObject = tracks.length > 0 ? new MediaStream(tracks) : null;
    if (tracks.length > 0) {
      void audio.play().catch((err: unknown) => {
        console.warn('[remote-audio] play failed', id, err);
      });
    }
  };

  const setPeers = (peers: RemoteAudioPeer[]) => {
    const seen = new Set<string>();

    for (const peer of peers) {
      seen.add(peer.id);

      const existing = listeners.get(peer.id);
      if (!existing || existing.stream !== peer.stream) {
        if (existing) {
          existing.stream.removeEventListener('addtrack', existing.onChange);
          existing.stream.removeEventListener('removetrack', existing.onChange);
        }
        const onChange = () => bind(peer.id, peer.stream);
        peer.stream.addEventListener('addtrack', onChange);
        peer.stream.addEventListener('removetrack', onChange);
        listeners.set(peer.id, { stream: peer.stream, onChange });
      }

      bind(peer.id, peer.stream);
    }

    for (const [id, audio] of elements) {
      if (seen.has(id)) continue;
      const entry = listeners.get(id);
      if (entry) {
        entry.stream.removeEventListener('addtrack', entry.onChange);
        entry.stream.removeEventListener('removetrack', entry.onChange);
        listeners.delete(id);
      }
      audio.pause();
      audio.srcObject = null;
      elements.delete(id);
    }
  };

  const stop = () => {
    for (const [id, entry] of listeners) {
      entry.stream.removeEventListener('addtrack', entry.onChange);
      entry.stream.removeEventListener('removetrack', entry.onChange);
      listeners.delete(id);
    }
    for (const audio of elements.values()) {
      audio.pause();
      audio.srcObject = null;
    }
    elements.clear();
  };

  return { setPeers, stop };
}
