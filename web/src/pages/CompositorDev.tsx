import { useEffect, useRef, useState } from 'react';
import { createCompositor, type Compositor } from '@streaming/canvas-compositor';
import { Button } from '../components/Button';
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
    <div className="min-h-screen flex flex-col bg-surface text-ink">
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-surface-raised">
        <h1 className="text-lg font-semibold m-0">Compositor playground</h1>
        <span className="text-sm text-ink-muted">
          {peerCount} peer{peerCount === 1 ? '' : 's'}
          {withScreen ? ' · screen' : ''}
        </span>
      </header>

      <main className="flex-1 grid gap-6 p-6 lg:grid-cols-[1fr_280px] items-start">
        <section>
          <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle mb-2.5">
            Program output
          </h2>
          <div className="preview rounded-xl overflow-hidden border border-border bg-black" ref={previewRef} />
        </section>

        <section>
          <h2 className="text-xs font-semibold tracking-[0.12em] uppercase text-ink-subtle mb-2.5">
            Controls
          </h2>
          <div className="flex flex-col gap-2.5 items-start">
            <Button variant="primary" onClick={addPeer}>
              Add peer
            </Button>
            <Button onClick={removePeer} disabled={peerCount === 0}>
              Remove last
            </Button>
            <Button onClick={clearPeers} disabled={peerCount === 0}>
              Clear all
            </Button>

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                className="w-auto m-0"
                checked={withAudio}
                onChange={(e) => setWithAudio(e.target.checked)}
              />
              New peers include audio
            </label>

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                className="w-auto m-0"
                checked={mixAudio}
                onChange={(e) => setMixAudio(e.target.checked)}
              />
              Mix audio into output
            </label>

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                className="w-auto m-0"
                checked={withScreen}
                onChange={(e) => onScreenToggle(e.target.checked)}
                disabled={peerCount === 0 && !withScreen}
              />
              Fake screen share (presentation layout)
            </label>
            <Button
              type="button"
              onClick={() => {
                compositorRef.current?.setOverlay({
                  author: 'Viewer123',
                  text: 'This is a sample YouTube comment on the program feed!',
                  until: Date.now() + 10_000,
                });
              }}
            >
              Show sample comment
            </Button>
            <Button type="button" onClick={() => compositorRef.current?.setOverlay(null)}>
              Clear comment
            </Button>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            Seed via URL: <code className="text-xs">?peers=4&amp;audio=0&amp;screen=1</code>. No
            server required.
          </p>
        </section>
      </main>
    </div>
  );
}
