import { useEffect, useRef, useState } from 'react';
import { createCompositor, type Compositor } from '../lib/compositor';
import {
  createFakePeer,
  createFakeScreen,
  type FakePeerHandle,
  type FakeScreenHandle,
} from '../lib/fakePeers';

const params = new URLSearchParams(location.search);
const initialCount = Math.min(8, Math.max(0, Number(params.get('peers') ?? 2) || 2));
const initialAudio = params.get('audio') !== '0';
const initialScreen = params.get('screen') === '1';

/**
 * Local playground for the compositor — no SFU, server, or camera needed.
 * Open /compositor-dev?peers=3&audio=1&screen=1
 */
export function CompositorDev() {
  const previewRef = useRef<HTMLDivElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const peersRef = useRef<FakePeerHandle[]>([]);
  const screenRef = useRef<FakeScreenHandle | null>(null);
  const nextIndexRef = useRef(0);

  const [peerCount, setPeerCount] = useState(0);
  const [mixAudio, setMixAudio] = useState(initialAudio);
  const [withAudio, setWithAudio] = useState(initialAudio);
  const [withScreen, setWithScreen] = useState(initialScreen);

  // Recreate compositor when mixAudio toggles (audio graph is baked in at create time).
  useEffect(() => {
    if (!previewRef.current) return;
    const compositor = createCompositor({ mixAudio });
    compositor.canvas.className = 'preview-canvas';
    previewRef.current.appendChild(compositor.canvas);
    compositorRef.current = compositor;
    compositor.setPeers(peersForCompositor());
    return () => {
      compositor.stop();
      compositor.canvas.remove();
      compositorRef.current = null;
    };
  }, [mixAudio]);

  // Seed initial fake peers once.
  useEffect(() => {
    for (let i = 0; i < initialCount; i++) addPeer();
    if (initialScreen) enableScreen();
    return () => {
      for (const peer of peersRef.current) peer.stop();
      peersRef.current = [];
      screenRef.current?.stop();
      screenRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount
  }, []);

  const peersForCompositor = (): FakePeerHandle[] => {
    const screen = screenRef.current?.stream;
    return peersRef.current.map((peer, i) =>
      i === 0 && screen ? { ...peer, screenStream: screen } : peer,
    );
  };

  const sync = () => {
    compositorRef.current?.setPeers(peersForCompositor());
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
    if (peersRef.current.length === 0) {
      screenRef.current?.stop();
      screenRef.current = null;
      setWithScreen(false);
    }
    sync();
  };

  const clearPeers = () => {
    for (const peer of peersRef.current) peer.stop();
    peersRef.current = [];
    screenRef.current?.stop();
    screenRef.current = null;
    setWithScreen(false);
    sync();
  };

  const enableScreen = () => {
    if (screenRef.current) return;
    if (peersRef.current.length === 0) addPeer();
    screenRef.current = createFakeScreen();
    setWithScreen(true);
    sync();
  };

  const disableScreen = () => {
    screenRef.current?.stop();
    screenRef.current = null;
    setWithScreen(false);
    sync();
  };

  const onScreenToggle = (enabled: boolean) => {
    if (enabled) enableScreen();
    else disableScreen();
  };

  return (
    <div className="studio compositor-dev">
      <header>
        <h1>Compositor playground</h1>
        <div className="header-right">
          <span className="hint">
            {peerCount} peer{peerCount === 1 ? '' : 's'}
            {withScreen ? ' · screen' : ''}
          </span>
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

            <label className="dev-toggle">
              <input
                type="checkbox"
                checked={withScreen}
                onChange={(e) => onScreenToggle(e.target.checked)}
                disabled={peerCount === 0 && !withScreen}
              />
              Fake screen share (presentation layout)
            </label>
          </div>
          <p className="hint">
            Seed via URL: <code>?peers=4&amp;audio=0&amp;screen=1</code>. No server required.
          </p>
        </section>
      </main>
    </div>
  );
}
