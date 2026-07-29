export interface CompositorPeer {
  id: string;
  name: string;
  stream: MediaStream;
}

export interface Compositor {
  canvas: HTMLCanvasElement;
  /** Canvas video track, plus a mixed audio track when mixAudio is enabled. */
  stream: MediaStream;
  setPeers: (peers: CompositorPeer[]) => void;
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
  audioSource?: MediaStreamAudioSourceNode;
  videoTrackCount: number;
}

/**
 * Draws all peers into a single canvas (grid layout, cover-fit, name labels)
 * and optionally mixes their audio with Web Audio. The same module powers the
 * studio's program preview and the headless recorder, so both are identical.
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
  let diagAt = 0;

  const bindVideo = (entry: TileEntry) => {
    entry.video.srcObject = entry.stream;
    entry.videoTrackCount = entry.stream.getVideoTracks().length;
    void entry.video.play().catch(() => undefined);
  };

  const setPeers = (peers: CompositorPeer[]) => {
    const seen = new Set<string>();
    for (const peer of peers) {
      seen.add(peer.id);
      let entry = entries.get(peer.id);
      if (!entry) {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        entry = {
          name: peer.name,
          stream: peer.stream,
          video,
          videoTrackCount: -1,
        };
        entries.set(peer.id, entry);
        bindVideo(entry);
      } else {
        entry.name = peer.name;
        entry.stream = peer.stream;
        const videoCount = peer.stream.getVideoTracks().length;
        if (entry.video.srcObject !== peer.stream || entry.videoTrackCount !== videoCount) {
          bindVideo(entry);
        }
      }
      // Tracks can arrive one at a time; hook up audio once it exists.
      if (audioCtx && audioDestination && !entry.audioSource && peer.stream.getAudioTracks().length > 0) {
        entry.audioSource = audioCtx.createMediaStreamSource(peer.stream);
        entry.audioSource.connect(audioDestination);
      }
    }
    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        entry.audioSource?.disconnect();
        entry.video.srcObject = null;
        entries.delete(id);
      }
    }
  };

  const drawTile = (entry: TileEntry, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(x, y, w, h);

    const video = entry.video;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      // cover-fit: crop the video to fill the tile
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const sw = w / scale;
      const sh = h / scale;
      const sx = (video.videoWidth - sw) / 2;
      const sy = (video.videoHeight - sh) / 2;
      ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const label = entry.name;
    ctx.font = '600 20px system-ui, sans-serif';
    const labelWidth = ctx.measureText(label).width + 20;
    ctx.fillRect(x + 12, y + h - 44, labelWidth, 32);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 22, y + h - 21);
  };

  const draw = () => {
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, width, height);

    const list = [...entries.values()];
    if (list.length === 0) {
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
        console.log(
          `[compositor] peer="${entry.name}" readyState=${v.readyState} ` +
            `${v.videoWidth}x${v.videoHeight} paused=${v.paused} tracks=[${tracks.join(',')}]`,
        );
      }
    }

    const cols = list.length <= 2 ? list.length : Math.ceil(Math.sqrt(list.length));
    const rows = Math.ceil(list.length / cols);
    const gap = 8;
    const tileW = (width - gap * (cols + 1)) / cols;
    const tileH = (height - gap * (rows + 1)) / rows;

    list.forEach((entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawTile(entry, gap + col * (tileW + gap), gap + row * (tileH + gap), tileW, tileH);
    });
  };

  // setInterval instead of requestAnimationFrame: keeps drawing in headless
  // Chromium and when the tab is not focused.
  const timer = window.setInterval(draw, 1000 / fps);

  const stream = canvas.captureStream(fps);
  if (audioDestination) {
    const audioTrack = audioDestination.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
  }

  const stop = () => {
    window.clearInterval(timer);
    for (const entry of entries.values()) {
      entry.audioSource?.disconnect();
      entry.video.srcObject = null;
    }
    entries.clear();
    for (const track of stream.getTracks()) track.stop();
    void audioCtx?.close();
  };

  return { canvas, stream, setPeers, stop };
}
