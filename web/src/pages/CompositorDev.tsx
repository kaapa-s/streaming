import { useEffect, useRef, useState } from 'react';
import {
  createCompositor,
  sourceId,
  type Compositor,
  type LayoutState,
} from '@streaming/canvas-compositor';
import { Button } from '../components/Button';
import { LAYOUT_OPTIONS } from '../components/studio/layoutIcons';
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
  const [peerList, setPeerList] = useState<{ id: string; name: string }[]>([]);
  const [mixAudio, setMixAudio] = useState(initialAudio);
  const [withAudio, setWithAudio] = useState(initialAudio);
  const [withScreen, setWithScreen] = useState(initialScreen);
  const [layout, setLayout] = useState<LayoutState>({
    cameraPreset: 'focus',
    featuredId: null,
    sceneScreenIds: [],
  });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Recreate compositor when mixAudio toggles (audio graph is baked in at create time).
  useEffect(() => {
    if (!previewRef.current) return;
    const compositor = createCompositor({ mixAudio });
    compositor.canvas.className = 'preview-canvas';
    previewRef.current.appendChild(compositor.canvas);
    compositorRef.current = compositor;
    compositor.setLayout(layoutRef.current);
    compositor.setPeers(peersForCompositor());
    return () => {
      compositor.stop();
      compositor.canvas.remove();
      compositorRef.current = null;
    };
  }, [mixAudio]);

  useEffect(() => {
    compositorRef.current?.setLayout(layout);
  }, [layout]);

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
    const list = peersRef.current.map((peer) => ({ id: peer.id, name: peer.name }));
    setPeerList(list);
    setPeerCount(list.length);
    const cameraIds = list.map((peer) => sourceId(peer.id, 'camera')).sort((a, b) => a.localeCompare(b));
    const liveScreens =
      screenRef.current && list[0] ? [sourceId(list[0].id, 'screen')] : [];
    setLayout((prev) => {
      const featuredId =
        prev.featuredId && cameraIds.includes(prev.featuredId)
          ? prev.featuredId
          : cameraIds[0] ?? null;
      const sceneScreenIds = prev.sceneScreenIds.filter((id) => liveScreens.includes(id));
      if (featuredId === prev.featuredId && sceneScreenIds.length === prev.sceneScreenIds.length) {
        return prev;
      }
      return { ...prev, featuredId, sceneScreenIds };
    });
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
            <p className="text-xs font-medium text-ink-muted">Layout</p>
            <div className="flex flex-wrap gap-2">
              {LAYOUT_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLayout((prev) => ({ ...prev, cameraPreset: item.id }))}
                  aria-label={item.label}
                  title={item.label}
                  className={`size-10 inline-flex items-center justify-center rounded-lg border transition-colors ${
                    layout.cameraPreset === item.id
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-surface text-ink-muted hover:text-ink'
                  }`}
                >
                  <item.Icon className="size-5" />
                </button>
              ))}
            </div>
            {withScreen && (
              <p className="text-xs text-ink-muted">
                Screen track is live. Add it to the scene to use presentation.
              </p>
            )}

            <p className="text-xs font-medium text-ink-muted mt-1">Featured camera</p>
            <div className="flex flex-wrap gap-2">
              {peerList.map((peer) => {
                const id = sourceId(peer.id, 'camera');
                const selected = layout.featuredId === id;
                return (
                  <button
                    key={peer.id}
                    type="button"
                    onClick={() => setLayout((prev) => ({ ...prev, featuredId: id }))}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-surface text-ink-muted hover:text-ink'
                    }`}
                  >
                    {peer.name}
                  </button>
                );
              })}
              {peerList.length === 0 && (
                <span className="text-sm text-ink-muted">Add a peer to pick a featured camera.</span>
              )}
            </div>

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
              Fake screen share (source only)
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                className="w-auto m-0"
                checked={
                  !!peerList[0] &&
                  layout.sceneScreenIds.includes(sourceId(peerList[0].id, 'screen'))
                }
                onChange={(e) => {
                  const first = peerList[0];
                  if (!first) return;
                  const id = sourceId(first.id, 'screen');
                  const enabled = e.target.checked;
                  setLayout((prev) => {
                    const has = prev.sceneScreenIds.includes(id);
                    if (enabled === has) return prev;
                    return {
                      ...prev,
                      sceneScreenIds: enabled
                        ? [...prev.sceneScreenIds, id]
                        : prev.sceneScreenIds.filter((screenId) => screenId !== id),
                    };
                  });
                }}
                disabled={!withScreen}
              />
              Screen on scene (presentation)
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
