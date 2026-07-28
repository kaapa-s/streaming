import { useEffect, useRef, useState } from 'react';
import { createCompositor, type Compositor } from '../lib/compositor';
import { createFakePeer, type FakePeerHandle } from '../lib/fakePeers';

const params = new URLSearchParams(location.search);
const initialCount = Math.min(8, Math.max(0, Number(params.get('peers') ?? 2) || 2));
const initialAudio = params.get('audio') !== '0';

/**
 * Local playground for the compositor — no SFU, server, or camera needed.
 * Open /compositor-dev?peers=3&audio=1
 */
export function CompositorDev() {
  const previewRef = useRef<HTMLDivElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const peersRef = useRef<FakePeerHandle[]>([]);
  const nextIndexRef = useRef(0);

  const [peerCount, setPeerCount] = useState(0);
  const [mixAudio, setMixAudio] = useState(initialAudio);
  const [withAudio, setWithAudio] = useState(initialAudio);

  // Recreate compositor when mixAudio toggles (audio graph is baked in at create time).
  useEffect(() => {
    if (!previewRef.current) return;
    const compositor = createCompositor({ mixAudio });
    compositor.canvas.className = 'preview-canvas';
    previewRef.current.appendChild(compositor.canvas);
    compositorRef.current = compositor;
    compositor.setPeers(peersRef.current);
    return () => {
      compositor.stop();
      compositor.canvas.remove();
      compositorRef.current = null;
    };
  }, [mixAudio]);

  // Seed initial fake peers once.
  useEffect(() => {
    for (let i = 0; i < initialCount; i++) addPeer();
    return () => {
      for (const peer of peersRef.current) peer.stop();
      peersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount
  }, []);

  const sync = () => {
    compositorRef.current?.setPeers(peersRef.current);
    setPeerCount(peersRef.current.length);
  };

  const addPeer = () => {
    const peer = createFakePeer(nextIndexRef.current++, { audio: withAudio });
    peersRef.current = [...peersRef.current, peer];
    sync();
  };

  const removePeer = () => {
    const peer = peersRef.current[peersRef.current.length - 1];
    if (!peer) return;
    peer.stop();
    peersRef.current = peersRef.current.slice(0, -1);
    sync();
  };

  const clearPeers = () => {
    for (const peer of peersRef.current) peer.stop();
    peersRef.current = [];
    sync();
  };

  return (
    <div className="studio compositor-dev">
      <header>
        <h1>Compositor playground</h1>
        <div className="header-right">
          <span className="hint">{peerCount} peer{peerCount === 1 ? '' : 's'}</span>
        </div>
      </header>

      <main>
        <section className="preview-section">
          <h2>Program output</h2>
          <div className="preview" ref={previewRef} />
        </section>

        <section>
          <h2>Controls</h2>
          <div className="dev-controls">
            <button type="button" className="primary" onClick={addPeer}>
              Add peer
            </button>
            <button type="button" onClick={removePeer} disabled={peerCount === 0}>
              Remove last
            </button>
            <button type="button" onClick={clearPeers} disabled={peerCount === 0}>
              Clear all
            </button>

            <label className="dev-toggle">
              <input
                type="checkbox"
                checked={withAudio}
                onChange={(e) => setWithAudio(e.target.checked)}
              />
              New peers include audio
            </label>

            <label className="dev-toggle">
              <input
                type="checkbox"
                checked={mixAudio}
                onChange={(e) => setMixAudio(e.target.checked)}
              />
              Mix audio into output
            </label>
          </div>
          <p className="hint">
            Seed via URL: <code>?peers=4&amp;audio=0</code>. No server required.
          </p>
        </section>
      </main>
    </div>
  );
}
