import { AUDIO } from '@streaming/stream-quality';
import {
  effectivePreset,
  layoutSolve,
  sourceId,
  type LayoutSource,
  type LayoutState,
  type LayoutSnapshot,
} from './layout';
import { wrapTextLines } from './wrap-text';

export type {
  CameraPreset,
  LayoutPreset,
  LayoutSnapshot,
  LayoutSource,
  LayoutState,
  Placement,
  SourceKind,
} from './layout';
export { effectivePreset, layoutSolve, sourceId, SPEAKER_STRIP_RATIO } from './layout';

export interface CompositorPeer {
  id: string;
  name: string;
  stream: MediaStream;
  /** Screen-share video; the solver treats this as `{peerId}:screen`. */
  screenStream?: MediaStream;
}

/** Host-curated lower-third shown on program output (studio + recorder). */
export interface CommentOverlay {
  author: string;
  text: string;
  /** Epoch ms; overlay clears itself after this time. */
  until?: number;
}

export interface Compositor {
  canvas: HTMLCanvasElement;
  /** Canvas video track, plus a mixed audio track when mixAudio is enabled. */
  stream: MediaStream;
  setPeers: (peers: CompositorPeer[]) => void;
  setOverlay: (overlay: CommentOverlay | null) => void;
  setLayout: (state: LayoutState) => void;
  getLayoutSnapshot: () => LayoutSnapshot;
  /** Resize the output canvas (e.g. studio preview fitting its container). */
  resize: (width: number, height: number) => void;
  /** Resume Web Audio so MediaRecorder gets a live mixed mic track (recorder only). */
  ensureAudio: () => Promise<void>;
  stop: () => void;
}

export interface CompositorOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** Mix peer audio into the output stream (recorder). Studio preview keeps this off. */
  mixAudio?: boolean;
}

interface TileEntry {
  peerId: string;
  name: string;
  stream: MediaStream;
  video: HTMLVideoElement;
  /** Hidden <audio> that keeps Chromium decoding remote mic RTP for the mix. */
  audioEl?: HTMLAudioElement;
  audioSource?: MediaStreamAudioSourceNode;
  /** Fingerprint of attached video track ids (not count — replacements keep count=1). */
  videoTrackIds: string;
  /** Fingerprint of mic tracks wired into the mix (empty when mixAudio is off). */
  audioTrackIds: string;
}

function createMixAudioContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: AUDIO.sampleRate, latencyHint: 'interactive' });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

interface ScreenEntry {
  peerId: string;
  name: string;
  stream: MediaStream;
  video: HTMLVideoElement;
  videoTrackIds: string;
}

function videoTrackIds(stream: MediaStream): string {
  return stream
    .getVideoTracks()
    .filter((t) => t.readyState !== 'ended')
    .map((t) => t.id)
    .join(',');
}

/**
 * Draws peers into a single canvas from `layoutSolve` placements and optionally
 * mixes their audio with Web Audio. The same module powers the studio program
 * preview and the headless recorder, so both are identical.
 */
export function createCompositor(options: CompositorOptions = {}): Compositor {
  let width = options.width ?? 1280;
  let height = options.height ?? 720;
  const { fps = 30, mixAudio = false } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // Opaque backing store lets Chromium use the GPU 2D path when a GPU is attached.
  const ctx =
    canvas.getContext('2d', { alpha: false, desynchronized: true }) ??
    canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');

  let audioCtx: AudioContext | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  let mixBus: GainNode | undefined;
  let mixKeepAlive: ConstantSourceNode | undefined;
  if (mixAudio) {
    audioCtx = createMixAudioContext();
    audioDestination = audioCtx.createMediaStreamDestination();
    // Headroom + limiter: peer mics (and summed guests) otherwise hit 0 dBFS
    // as single-sample spikes that decode as clicks.
    const gain = audioCtx.createGain();
    gain.gain.value = AUDIO.mixGain;
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    gain.connect(limiter);
    limiter.connect(audioDestination);
    mixBus = gain;
    mixKeepAlive = audioCtx.createConstantSource();
    mixKeepAlive.offset.value = 0;
    mixKeepAlive.connect(mixBus);
    mixKeepAlive.start();
    void audioCtx.resume();
  }

  const entries = new Map<string, TileEntry>();
  const screens = new Map<string, ScreenEntry>();
  let layoutState: LayoutState = { cameraPreset: 'focus', featuredId: null, sceneScreenIds: [] };
  let commentOverlay: CommentOverlay | null = null;
  let diagAt = 0;

  const createVideoEl = () => {
    const video = document.createElement('video');
    // Belt-and-suspenders: these elements must never contribute to speakers.
    // Audio for recording goes through Web Audio (mixAudio), not <video>.
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.playsInline = true;
    video.autoplay = true;
    return video;
  };

  const detachPeerAudio = (entry: TileEntry) => {
    entry.audioSource?.disconnect();
    entry.audioSource = undefined;
    if (entry.audioEl) {
      entry.audioEl.pause();
      entry.audioEl.srcObject = null;
      entry.audioEl = undefined;
    }
    entry.audioTrackIds = '';
  };

  const bindVideo = (video: HTMLVideoElement, stream: MediaStream): string => {
    const ids = videoTrackIds(stream);
    // Camera frames only on <video> — never attach mic here (feedback in studio,
    // and a dual video+WebAudio consumer of the same stream crackles in Chrome).
    const tracks = stream.getVideoTracks().filter((t) => t.readyState !== 'ended');
    video.srcObject = tracks.length > 0 ? new MediaStream(tracks) : null;
    if (ids) {
      void video.play().catch((err: unknown) => {
        console.warn('[compositor] video play failed', err);
      });
    }
    return ids;
  };

  /** Recorder-only: tap peer mic into the MediaRecorder mix via Web Audio. */
  const audioPeerIdsOnScene = (): Set<string> => {
    const sources = currentSources();
    return new Set(
      layoutSolve(layoutState, sources, width, height)
        .map((placement) => placement.sourceId)
        .filter((id) => id.endsWith(':camera'))
        .map((id) => id.slice(0, -':camera'.length)),
    );
  };

  const bindPeerAudio = (entry: TileEntry, stream: MediaStream) => {
    if (!audioCtx || !mixBus) return;
    const onScene = audioPeerIdsOnScene().has(entry.peerId);
    const tracks = onScene
      ? stream.getAudioTracks().filter((t) => t.readyState !== 'ended')
      : [];
    const ids = tracks.map((t) => t.id).join(',');
    if (entry.audioTrackIds === ids) return;

    detachPeerAudio(entry);
    entry.audioTrackIds = ids;
    if (!ids) return;

    // Chromium will not decode remote mic RTP into MediaStreamSource unless a
    // media element is playing that audio. Use a dedicated muted <audio> — not
    // the canvas <video> — so cam and mic are not dual-consumed on one stream.
    const audioStream = new MediaStream(tracks);
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.muted = true;
    audioEl.defaultMuted = true;
    audioEl.volume = 0;
    audioEl.srcObject = audioStream;
    void audioEl.play().catch((err: unknown) => {
      console.warn('[compositor] audio play failed', err);
    });
    entry.audioEl = audioEl;
    entry.audioSource = audioCtx.createMediaStreamSource(audioStream);
    entry.audioSource.connect(mixBus);
  };

  const bindScreen = (peer: CompositorPeer, stream: MediaStream) => {
    let entry = screens.get(peer.id);
    if (!entry) {
      const video = createVideoEl();
      screens.set(peer.id, {
        peerId: peer.id,
        name: peer.name,
        stream,
        video,
        videoTrackIds: bindVideo(video, stream),
      });
      return;
    }
    entry.name = peer.name;
    const streamChanged = entry.stream !== stream;
    entry.stream = stream;
    const ids = videoTrackIds(stream);
    if (streamChanged || entry.videoTrackIds !== ids) {
      entry.videoTrackIds = bindVideo(entry.video, stream);
    } else if (ids && entry.video.paused) {
      void entry.video.play().catch(() => undefined);
    }
  };

  const setPeers = (peers: CompositorPeer[]) => {
    const seen = new Set<string>();
    const seenScreens = new Set<string>();

    for (const peer of peers) {
      seen.add(peer.id);
      let entry = entries.get(peer.id);
      if (!entry) {
        const video = createVideoEl();
        entry = {
          peerId: peer.id,
          name: peer.name,
          stream: peer.stream,
          video,
          videoTrackIds: '',
          audioTrackIds: '',
        };
        entries.set(peer.id, entry);
        entry.videoTrackIds = bindVideo(entry.video, entry.stream);
      } else {
        entry.name = peer.name;
        const streamChanged = entry.stream !== peer.stream;
        entry.stream = peer.stream;
        const ids = videoTrackIds(peer.stream);
        // srcObject is a video-only clone, so never compare it to peer.stream.
        // Only rebind when video track identity changes (mic addtrack is a no-op).
        if (streamChanged || entry.videoTrackIds !== ids) {
          entry.videoTrackIds = bindVideo(entry.video, peer.stream);
        } else if (ids && entry.video.paused) {
          void entry.video.play().catch(() => undefined);
        }
      }
      // Mix peer mics via Web Audio (recorder). No-op when mixAudio is false.
      bindPeerAudio(entry, peer.stream);

      const screenStream = peer.screenStream;
      if (
        screenStream &&
        screenStream.getVideoTracks().some((track) => track.readyState !== 'ended')
      ) {
        seenScreens.add(peer.id);
        bindScreen(peer, screenStream);
      }
    }

    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        detachPeerAudio(entry);
        entry.video.srcObject = null;
        entries.delete(id);
      }
    }

    for (const [id, entry] of screens) {
      if (!seenScreens.has(id)) {
        entry.video.srcObject = null;
        screens.delete(id);
      }
    }
  };

  const aspectOf = (video: HTMLVideoElement): number | undefined => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight;
    }
    return undefined;
  };

  const currentSources = (): LayoutSource[] => {
    const sources: LayoutSource[] = [];
    for (const [peerId, entry] of entries) {
      sources.push({
        id: sourceId(peerId, 'camera'),
        peerId,
        kind: 'camera',
        name: entry.name,
        aspectRatio: aspectOf(entry.video),
      });
    }
    for (const [peerId, entry] of screens) {
      sources.push({
        id: sourceId(peerId, 'screen'),
        peerId,
        kind: 'screen',
        name: entry.name,
        aspectRatio: aspectOf(entry.video),
      });
    }
    return sources;
  };

  const videoFor = (id: string): HTMLVideoElement | undefined => {
    if (id.endsWith(':camera')) {
      return entries.get(id.slice(0, -':camera'.length))?.video;
    }
    if (id.endsWith(':screen')) {
      return screens.get(id.slice(0, -':screen'.length))?.video;
    }
    return undefined;
  };

  const drawLabel = (name: string, x: number, y: number, w: number, h: number) => {
    const font = '600 20px system-ui, sans-serif';
    const lineH = 24;
    const padX = 10;
    const padY = 6;
    const inset = 12;
    const maxBoxW = Math.max(0, w - inset * 2);
    const maxTextW = Math.max(1, maxBoxW - padX * 2);
    const maxLines = Math.min(4, Math.max(1, Math.floor((h - inset - padY * 2) / lineH)));

    ctx.font = font;
    const lines = wrapTextLines(name, maxTextW, (s) => ctx.measureText(s).width, maxLines);
    if (lines.length === 0) return;

    let textW = 0;
    for (const line of lines) {
      textW = Math.max(textW, ctx.measureText(line).width);
    }
    const boxW = Math.min(maxBoxW, Math.ceil(textW + padX * 2));
    const boxH = padY * 2 + lines.length * lineH;
    const boxX = x + inset;
    const boxY = y + h - inset - boxH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = '#fff';
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let ty = boxY + padY;
    for (const line of lines) {
      ctx.fillText(line, boxX + padX, ty);
      ty += lineH;
    }
    ctx.restore();
  };

  const drawTileCover = (
    video: HTMLVideoElement | undefined,
    name: string | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(x, y, w, h);

    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const sw = w / scale;
      const sh = h / scale;
      const sx = (video.videoWidth - sw) / 2;
      const sy = (video.videoHeight - sh) / 2;
      ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
    }

    if (name) drawLabel(name, x, y, w, h);
  };

  const drawTileContain = (
    video: HTMLVideoElement | undefined,
    name: string | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(x, y, w, h);

    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      const dx = x + (w - dw) / 2;
      const dy = y + (h - dh) / 2;
      ctx.drawImage(video, dx, dy, dw, dh);
    }

    if (name) drawLabel(name, x, y, w, h);
  };

  const setOverlay = (overlay: CommentOverlay | null) => {
    commentOverlay = overlay;
  };

  const setLayout = (state: LayoutState) => {
    layoutState = {
      cameraPreset: state.cameraPreset,
      featuredId: state.featuredId,
      sceneScreenIds: state.sceneScreenIds ?? [],
    };
    if (audioCtx) {
      for (const entry of entries.values()) bindPeerAudio(entry, entry.stream);
    }
  };

  const getLayoutSnapshot = (): LayoutSnapshot => {
    const sources = currentSources();
    return {
      cameraPreset: layoutState.cameraPreset,
      featuredId: layoutState.featuredId,
      sceneScreenIds: [...layoutState.sceneScreenIds],
      effective: effectivePreset(layoutState, sources),
      sources: sources.map((source) => source.id).sort((a, b) => a.localeCompare(b)),
      audioSourceIds: [...entries.values()]
        .filter((entry) => entry.audioSource)
        .map((entry) => sourceId(entry.peerId, 'camera'))
        .sort((a, b) => a.localeCompare(b)),
    };
  };

  const wrapText = (text: string, maxWidth: number, font: string): string[] => {
    ctx.font = font;
    return wrapTextLines(text, maxWidth, (s) => ctx.measureText(s).width).slice(0, 3);
  };

  const drawCommentOverlay = () => {
    if (!commentOverlay) return;
    if (commentOverlay.until !== undefined && Date.now() >= commentOverlay.until) {
      commentOverlay = null;
      return;
    }

    const margin = Math.round(width * 0.04);
    const cardW = Math.min(Math.round(width * 0.55), width - margin * 2);
    const padX = 28;
    const padY = 20;
    const authorFont = `700 ${Math.max(18, Math.round(height * 0.028))}px system-ui, sans-serif`;
    const bodyFont = `500 ${Math.max(20, Math.round(height * 0.032))}px system-ui, sans-serif`;
    const maxTextW = cardW - padX * 2;
    const lines = wrapText(commentOverlay.text, maxTextW, bodyFont);
    const lineH = Math.max(26, Math.round(height * 0.038));
    const authorH = Math.max(22, Math.round(height * 0.03));
    const cardH = padY * 2 + authorH + 8 + lines.length * lineH;
    const x = margin;
    const y = height - margin - cardH;

    ctx.fillStyle = 'rgba(10, 12, 16, 0.82)';
    ctx.beginPath();
    const r = 12;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + cardW, y, x + cardW, y + cardH, r);
    ctx.arcTo(x + cardW, y + cardH, x, y + cardH, r);
    ctx.arcTo(x, y + cardH, x, y, r);
    ctx.arcTo(x, y, x + cardW, y, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#7eb6ff';
    ctx.font = authorFont;
    ctx.fillText(commentOverlay.author, x + padX, y + padY + authorH - 4);

    ctx.fillStyle = '#f2f4f8';
    ctx.font = bodyFont;
    let ty = y + padY + authorH + 8 + lineH - 6;
    for (const line of lines) {
      ctx.fillText(line, x + padX, ty);
      ty += lineH;
    }
  };

  const draw = () => {
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, width, height);

    const sources = currentSources();
    if (sources.length === 0) {
      ctx.fillStyle = '#5c6470';
      ctx.font = '600 32px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for speakers…', width / 2, height / 2);
      ctx.textAlign = 'left';
      drawCommentOverlay();
      return;
    }

    const now = performance.now();
    if (now - diagAt > 2000) {
      diagAt = now;
      for (const entry of entries.values()) {
        const v = entry.video;
        const tracks = entry.stream.getVideoTracks().map((t) => `${t.readyState}/${t.muted ? 'muted' : 'live'}`);
        const aTracks = entry.stream.getAudioTracks().map((t) => `${t.readyState}/${t.muted ? 'muted' : 'live'}`);
        console.log(
          `[compositor] peer="${entry.name}" readyState=${v.readyState} ` +
            `${v.videoWidth}x${v.videoHeight} paused=${v.paused} tracks=[${tracks.join(',')}] ` +
            `audio=[${aTracks.join(',')}] mix=${entry.audioSource ? 'on' : 'off'}`,
        );
      }
      for (const entry of screens.values()) {
        const v = entry.video;
        console.log(
          `[compositor] screen peerId=${entry.peerId} readyState=${v.readyState} ` +
            `${v.videoWidth}x${v.videoHeight}`,
        );
      }
    }

    const placements = layoutSolve(layoutState, sources, width, height);
    for (const placement of placements) {
      const video = videoFor(placement.sourceId);
      if (placement.fit === 'contain') {
        drawTileContain(video, placement.label, placement.x, placement.y, placement.w, placement.h);
      } else {
        drawTileCover(video, placement.label, placement.x, placement.y, placement.w, placement.h);
      }
    }
    drawCommentOverlay();
  };

  // Chained setTimeout (not setInterval / rAF): rAF does not fire in headless
  // Chromium, and setInterval piles up callbacks when a 1080p60 draw overruns
  // (~23 fps observed), starving the Web Audio / MediaRecorder thread and
  // producing clicks. Scheduling the next frame after draw() yields a
  // sustainable rate instead of a backlog.
  let timer = 0;
  let stopped = false;
  const scheduleDraw = () => {
    timer = window.setTimeout(() => {
      if (stopped) return;
      try {
        draw();
      } finally {
        if (!stopped) scheduleDraw();
      }
    }, 1000 / fps);
  };
  scheduleDraw();

  const stream = canvas.captureStream(fps);
  if (audioDestination) {
    const audioTrack = audioDestination.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
  }

  const ensureAudio = async () => {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    if (audioCtx.sampleRate !== AUDIO.sampleRate) {
      throw new Error(
        `AudioContext sampleRate is ${audioCtx.sampleRate}, need ${AUDIO.sampleRate}. ` +
          'Recording would crackle (Web Audio / Opus clock mismatch).',
      );
    }
    const track = audioDestination?.stream.getAudioTracks()[0];
    console.log(
      `[compositor] ensureAudio state=${audioCtx.state} sampleRate=${audioCtx.sampleRate} ` +
        `mixPeers=${[...entries.values()].filter((e) => e.audioSource).length} ` +
        `outTrack=${track ? `${track.readyState}/${track.muted ? 'muted' : 'live'}` : 'none'}`,
    );
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    const w = Math.max(2, Math.floor(nextWidth / 2) * 2);
    const h = Math.max(2, Math.floor(nextHeight / 2) * 2);
    if (w === width && h === height) return;
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
  };

  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    for (const entry of entries.values()) {
      detachPeerAudio(entry);
      entry.video.srcObject = null;
    }
    entries.clear();
    for (const entry of screens.values()) {
      entry.video.srcObject = null;
    }
    screens.clear();
    for (const track of stream.getTracks()) track.stop();
    try {
      mixKeepAlive?.stop();
    } catch {
      // already stopped
    }
    mixKeepAlive?.disconnect();
    mixKeepAlive = undefined;
    void audioCtx?.close();
  };

  return { canvas, stream, setPeers, setOverlay, setLayout, getLayoutSnapshot, resize, ensureAudio, stop };
}
