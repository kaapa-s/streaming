import { AUDIO } from '@streaming/stream-quality';

export interface CompositorPeer {
  id: string;
  name: string;
  stream: MediaStream;
  /** When set, triggers presentation layout (left cameras + main screen). */
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

const SPEAKER_STRIP_RATIO = 0.14;

/**
 * Draws all peers into a single canvas (grid layout, cover-fit, name labels)
 * and optionally mixes their audio with Web Audio. The same module powers the
 * studio's program preview and the headless recorder, so both are identical.
 *
 * When any peer has a screenStream, switches to presentation layout:
 * shrunk cameras stacked on the left, screen contain-fit on the right.
 */
export function createCompositor(options: CompositorOptions = {}): Compositor {
  let width = options.width ?? 1280;
  let height = options.height ?? 720;
  const { fps = 30, mixAudio = false } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
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
  let screenEntry: ScreenEntry | undefined;
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
  const bindPeerAudio = (entry: TileEntry, stream: MediaStream) => {
    if (!audioCtx || !mixBus) return;
    const tracks = stream.getAudioTracks().filter((t) => t.readyState !== 'ended');
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

  const setPeers = (peers: CompositorPeer[]) => {
    const seen = new Set<string>();
    let nextScreen: { peerId: string; stream: MediaStream } | undefined;

    for (const peer of peers) {
      seen.add(peer.id);
      let entry = entries.get(peer.id);
      if (!entry) {
        const video = createVideoEl();
        entry = {
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

      // First peer with a screenStream wins (deterministic peer order).
      if (!nextScreen && peer.screenStream && peer.screenStream.getVideoTracks().length > 0) {
        nextScreen = { peerId: peer.id, stream: peer.screenStream };
      }
    }

    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        detachPeerAudio(entry);
        entry.video.srcObject = null;
        entries.delete(id);
      }
    }

    if (nextScreen) {
      if (
        !screenEntry ||
        screenEntry.peerId !== nextScreen.peerId ||
        screenEntry.stream !== nextScreen.stream
      ) {
        if (screenEntry) screenEntry.video.srcObject = null;
        const video = createVideoEl();
        screenEntry = {
          peerId: nextScreen.peerId,
          stream: nextScreen.stream,
          video,
          videoTrackIds: bindVideo(video, nextScreen.stream),
        };
      } else {
        const ids = videoTrackIds(nextScreen.stream);
        if (screenEntry.videoTrackIds !== ids) {
          screenEntry.videoTrackIds = bindVideo(screenEntry.video, nextScreen.stream);
        } else if (ids && screenEntry.video.paused) {
          void screenEntry.video.play().catch(() => undefined);
        }
      }
    } else if (screenEntry) {
      screenEntry.video.srcObject = null;
      screenEntry = undefined;
    }
  };

  const drawTileCover = (
    video: HTMLVideoElement,
    name: string | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(x, y, w, h);

    if (video.readyState >= 2 && video.videoWidth > 0) {
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const sw = w / scale;
      const sh = h / scale;
      const sx = (video.videoWidth - sw) / 2;
      const sy = (video.videoHeight - sh) / 2;
      ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
    }

    if (name) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.font = '600 20px system-ui, sans-serif';
      const labelWidth = ctx.measureText(name).width + 20;
      ctx.fillRect(x + 12, y + h - 44, labelWidth, 32);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, x + 22, y + h - 21);
    }
  };

  const drawGrid = (list: TileEntry[]) => {
    const cols = list.length <= 2 ? list.length : Math.ceil(Math.sqrt(list.length));
    const rows = Math.ceil(list.length / cols);
    const gap = 8;
    const tileW = (width - gap * (cols + 1)) / cols;
    const tileH = (height - gap * (rows + 1)) / rows;

    list.forEach((entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawTileCover(
        entry.video,
        entry.name,
        gap + col * (tileW + gap),
        gap + row * (tileH + gap),
        tileW,
        tileH,
      );
    });
  };

  const drawPresentation = (speakers: TileEntry[], screen: ScreenEntry) => {
    const gap = 8;
    const stripW = Math.floor(width * SPEAKER_STRIP_RATIO);
    const mainX = stripW + gap;
    const mainW = width - mainX - gap;
    const mainY = gap;
    const mainH = height - gap * 2;

    // Fill main area; then draw the largest AR-correct rect from the live
    // capture size (videoWidth/Height update when the shared window resizes).
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(mainX, mainY, mainW, mainH);

    const video = screen.video;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const scale = Math.min(mainW / video.videoWidth, mainH / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      const dx = mainX + (mainW - dw) / 2;
      const dy = mainY + (mainH - dh) / 2;
      ctx.drawImage(video, dx, dy, dw, dh);
    }

    if (speakers.length === 0) return;

    const tileW = stripW - gap;
    const tileH = Math.min(
      tileW * (9 / 16),
      (height - gap * (speakers.length + 1)) / speakers.length,
    );
    const totalH = speakers.length * tileH + (speakers.length - 1) * gap;
    let y = Math.max(gap, (height - totalH) / 2);

    for (const entry of speakers) {
      drawTileCover(entry.video, entry.name, gap, y, tileW, tileH);
      y += tileH + gap;
    }
  };

  const setOverlay = (overlay: CommentOverlay | null) => {
    commentOverlay = overlay;
  };

  const wrapText = (text: string, maxWidth: number, font: string): string[] => {
    ctx.font = font;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines: string[] = [];
    let line = words[0] ?? '';
    for (let i = 1; i < words.length; i++) {
      const word = words[i] ?? '';
      const next = `${line} ${word}`;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    return lines.slice(0, 3);
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

    const list = [...entries.values()];
    if (list.length === 0 && !screenEntry) {
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
      for (const entry of list) {
        const v = entry.video;
        const tracks = entry.stream.getVideoTracks().map((t) => `${t.readyState}/${t.muted ? 'muted' : 'live'}`);
        const aTracks = entry.stream.getAudioTracks().map((t) => `${t.readyState}/${t.muted ? 'muted' : 'live'}`);
        console.log(
          `[compositor] peer="${entry.name}" readyState=${v.readyState} ` +
            `${v.videoWidth}x${v.videoHeight} paused=${v.paused} tracks=[${tracks.join(',')}] ` +
            `audio=[${aTracks.join(',')}] mix=${entry.audioSource ? 'on' : 'off'}`,
        );
      }
      if (screenEntry) {
        const v = screenEntry.video;
        console.log(
          `[compositor] screen peerId=${screenEntry.peerId} readyState=${v.readyState} ` +
            `${v.videoWidth}x${v.videoHeight}`,
        );
      }
    }

    if (screenEntry) {
      drawPresentation(list, screenEntry);
    } else {
      drawGrid(list);
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
    if (screenEntry) {
      screenEntry.video.srcObject = null;
      screenEntry = undefined;
    }
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

  return { canvas, stream, setPeers, setOverlay, resize, ensureAudio, stop };
}
