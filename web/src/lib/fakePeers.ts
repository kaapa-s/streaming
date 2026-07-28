import type { CompositorPeer } from './compositor';

export interface FakePeerHandle extends CompositorPeer {
  stop: () => void;
}

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi'];

/**
 * Synthesizes a MediaStream with animated canvas video and an optional
 * oscillator audio track — no camera, mic, or SFU required.
 */
export function createFakePeer(index: number, { audio = true } = {}): FakePeerHandle {
  const id = `fake-${index}-${Math.random().toString(36).slice(2, 7)}`;
  const name = NAMES[index % NAMES.length] ?? `Peer ${index + 1}`;
  const hue = (index * 67) % 360;

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d')!;

  let frame = 0;
  const draw = () => {
    frame += 1;
    ctx.fillStyle = `hsl(${hue} 42% 22%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // bouncing circle so cover-fit / motion is obvious
    const cx = canvas.width / 2 + Math.sin(frame / 30) * 120;
    const cy = canvas.height / 2 + Math.cos(frame / 40) * 60;
    ctx.beginPath();
    ctx.arc(cx, cy, 48, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${hue} 70% 55%)`;
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '600 36px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 8);
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(`frame ${frame}`, canvas.width / 2, canvas.height - 24);
    ctx.textAlign = 'left';
  };
  draw();
  const timer = window.setInterval(draw, 1000 / 30);

  const stream = canvas.captureStream(30);
  let audioCtx: AudioContext | undefined;

  if (audio) {
    audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const dest = audioCtx.createMediaStreamDestination();
    // Distinct pitch per peer so mixed audio is audible/testable
    osc.frequency.value = 220 + (index % 8) * 55;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    void audioCtx.resume();
    const track = dest.stream.getAudioTracks()[0];
    if (track) stream.addTrack(track);
  }

  const stop = () => {
    window.clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    void audioCtx?.close();
  };

  return { id, name, stream, stop };
}
