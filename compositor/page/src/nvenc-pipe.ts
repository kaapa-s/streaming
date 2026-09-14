const RAW_VIDEO = 1;
const RAW_AUDIO = 2;

interface TrackProcessor<T> {
  readable: ReadableStream<T>;
}

interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): TrackProcessor<VideoFrame | AudioData>;
}

function requireTrackProcessor(): TrackProcessorCtor {
  const ctor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor;
  if (!ctor) {
    throw new Error('MediaStreamTrackProcessor is not available in this Chromium');
  }
  return ctor;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

async function videoPacket(frame: VideoFrame): Promise<ArrayBuffer> {
  const size = frame.allocationSize({ format: 'I420' });
  const packet = new Uint8Array(1 + size);
  packet[0] = RAW_VIDEO;
  await frame.copyTo(packet.subarray(1), { format: 'I420' });
  return bytesToArrayBuffer(packet);
}

function audioPacket(data: AudioData): ArrayBuffer {
  const channels = Math.min(data.numberOfChannels, 2);
  const frames = data.numberOfFrames;
  const interleaved = new Float32Array(frames * 2);
  try {
    for (let c = 0; c < channels; c++) {
      const plane = new Float32Array(frames);
      data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
      const offset = c === 0 ? 0 : 1;
      for (let i = 0; i < frames; i++) {
        interleaved[i * 2 + offset] = plane[i] ?? 0;
      }
    }
    if (channels === 1) {
      for (let i = 0; i < frames; i++) interleaved[i * 2 + 1] = interleaved[i * 2];
    }
  } catch {
    const packed = new Float32Array(frames * data.numberOfChannels);
    data.copyTo(packed, { planeIndex: 0, format: 'f32' });
    for (let i = 0; i < frames; i++) {
      interleaved[i * 2] = packed[i * data.numberOfChannels] ?? 0;
      interleaved[i * 2 + 1] =
        data.numberOfChannels > 1 ? (packed[i * data.numberOfChannels + 1] ?? 0) : interleaved[i * 2];
    }
  }
  const packet = new Uint8Array(1 + interleaved.byteLength);
  packet[0] = RAW_AUDIO;
  packet.set(new Uint8Array(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength), 1);
  return bytesToArrayBuffer(packet);
}

async function pumpTrack(
  track: MediaStreamTrack,
  ws: WebSocket,
  abort: AbortSignal,
  kind: 'video' | 'audio',
): Promise<void> {
  const Processor = requireTrackProcessor();
  const processor = new Processor({ track });
  const reader = processor.readable.getReader();
  try {
    while (!abort.aborted) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      if (ws.readyState !== WebSocket.OPEN) {
        value.close();
        break;
      }
      try {
        if (kind === 'video' && value instanceof VideoFrame) {
          const packet = await videoPacket(value);
          ws.send(packet);
        } else if (kind === 'audio' && typeof (value as AudioData).numberOfFrames === 'number') {
          ws.send(audioPacket(value as AudioData));
        }
      } finally {
        value.close();
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Stream canvas I420 + mix PCM over the recording WebSocket for ffmpeg NVENC. */
export function startNvencPipe(
  stream: MediaStream,
  ws: WebSocket,
): { stop: () => void } {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('nvenc pipe: output stream has no video track');
  const audioTrack = stream.getAudioTracks()[0];
  const abort = new AbortController();
  const jobs = [
    pumpTrack(videoTrack, ws, abort.signal, 'video'),
    audioTrack
      ? pumpTrack(audioTrack, ws, abort.signal, 'audio')
      : Promise.resolve(),
  ];
  void Promise.all(jobs).catch((err: unknown) => {
    console.error('[compositor] nvenc pipe failed', err);
  });
  return {
    stop: () => abort.abort(),
  };
}
