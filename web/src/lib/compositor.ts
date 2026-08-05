export interface CompositorPeer {
  id: string;
  name: string;
  stream: MediaStream;
  /** When set, triggers presentation layout (left cameras + main screen). */
  screenStream?: MediaStream;
}

export interface Compositor {
  canvas: HTMLCanvasElement;
  /** Canvas video track, plus a mixed audio track when mixAudio is enabled. */
  stream: MediaStream;
  setPeers: (peers: CompositorPeer[]) => void;
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
  /** Playing (muted) mic element — required so Chromium decodes remote WebRTC audio. */
  audioEl?: HTMLAudioElement;
  audioSource?: MediaStreamAudioSourceNode;
  /** Fingerprint of attached video track ids (not count — replacements keep count=1). */
  videoTrackIds: string;
  /** Fingerprint of mic tracks wired into the mix (empty when mixAudio is off). */
  audioTrackIds: string;
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

const SPEAKER_STRIP_RATIO = 0.22;

/**
 * Draws all peers into a single canvas (grid layout, cover-fit, name labels)
 * and optionally mixes their audio with Web Audio. The same module powers the
 * studio's program preview and the headless recorder, so both are identical.
 *
 * When any peer has a screenStream, switches to presentation layout:
 * shrunk cameras stacked on the left, screen contain-fit on the right.
 */
export function createCompositor(options: CompositorOptions = {}): Compositor {
  const { width = 1280, height = 720, fps = 30, mixAudio = false } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');

  let audioCtx: AudioContext | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  if (mixAudio) {
    audioCtx = new AudioContext();
    audioDestination = audioCtx.createMediaStreamDestination();
    void audioCtx.resume();
  }

  const entries = new Map<string, TileEntry>();
  let screenEntry: ScreenEntry | undefined;
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
    // Video tracks only — never attach mic/audio here. Off-DOM <video> elements
    // can still leak local mic to speakers if the full stream is bound.
    // Audio mixing (recorder) uses Web Audio from peer.stream separately.
    const tracks = stream.getVideoTracks().filter((t) => t.readyState !== 'ended');
    const ids = tracks.map((t) => t.id).join(',');
    video.srcObject = tracks.length > 0 ? new MediaStream(tracks) : null;
    if (tracks.length > 0) {
      void video.play().catch((err: unknown) => {
        console.warn('[compositor] video play failed', err);
      });
    }
    return ids;
  };

  /**
   * Recorder-only audio path (studio uses mixAudio:false — never runs there).
   *
   * After the feedback fix, <video> only gets camera tracks. Chromium then stops
   * decoding remote mic RTP for tracks that have no media-element consumer, so
   * createMediaStreamSource alone produced a silent Opus track in the .webm.
   * Play each mic through a muted <audio> (decode, no speakers) and tap the
   * track into the mix with MediaStreamSource.
   */
  const bindPeerAudio = (entry: TileEntry, stream: MediaStream) => {
    if (!audioCtx || !audioDestination) return;
    const tracks = stream.getAudioTracks().filter((t) => t.readyState !== 'ended');
    const ids = tracks.map((t) => t.id).join(',');
    if (entry.audioTrackIds === ids) {
      if (entry.audioEl && tracks.length > 0 && entry.audioEl.paused) {
        void entry.audioEl.play().catch(() => undefined);
      }
      return;
    }

    detachPeerAudio(entry);
    entry.audioTrackIds = ids;
    if (!ids) return;

    const micStream = new MediaStream(tracks);

    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioEl.muted = true;
    audioEl.srcObject = micStream;
    entry.audioEl = audioEl;
    void audioEl.play().catch((err: unknown) => {
      console.warn('[compositor] audio play failed', entry.name, err);
    });

    entry.audioSource = audioCtx.createMediaStreamSource(micStream);
    entry.audioSource.connect(audioDestination);
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
      // Mix peer mics via playing <audio> + Web Audio (never via <video>).
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

  const drawContain = (video: HTMLVideoElement, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(x, y, w, h);

    if (video.readyState >= 2 && video.videoWidth > 0) {
      const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      const dx = x + (w - dw) / 2;
      const dy = y + (h - dh) / 2;
      ctx.drawImage(video, dx, dy, dw, dh);
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

    drawContain(screen.video, mainX, mainY, mainW, mainH);

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
            `audio=[${aTracks.join(',')}] mix=${entry.audioSource ? 'on' : 'off'} ` +
            `audioEl=${entry.audioEl ? (entry.audioEl.paused ? 'paused' : 'playing') : 'none'}`,
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
  };

  // setInterval instead of requestAnimationFrame: keeps drawing in headless
  // Chromium and when the tab is not focused.
  const timer = window.setInterval(draw, 1000 / fps);

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
    for (const entry of entries.values()) {
      if (entry.audioEl && entry.audioEl.paused) {
        void entry.audioEl.play().catch(() => undefined);
      }
    }
    const track = audioDestination?.stream.getAudioTracks()[0];
    console.log(
      `[compositor] ensureAudio state=${audioCtx.state} ` +
        `mixPeers=${[...entries.values()].filter((e) => e.audioSource).length} ` +
        `outTrack=${track ? `${track.readyState}/${track.muted ? 'muted' : 'live'}` : 'none'}`,
    );
  };

  const stop = () => {
    window.clearInterval(timer);
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
    void audioCtx?.close();
  };

  return { canvas, stream, setPeers, ensureAudio, stop };
}
