const RAW_VIDEO = 1;
const RAW_AUDIO = 2;

/**
 * WebCodecs pixel format → wire code. Must stay in sync with VIDEO_FORMATS in
 * compositor/src/recordings/raw-pipe.ts, which maps the code to an ffmpeg
 * `-pix_fmt`. (The page is a separate Vite build and cannot import from the
 * Nest service, so the kind bytes above are duplicated the same way.)
 */
const VIDEO_FORMAT_CODES: Record<string, number> = {
  I420: 1,
  NV12: 2,
  I420A: 3,
  I422: 4,
  I444: 5,
  RGBA: 6,
  RGBX: 7,
  BGRA: 8,
  BGRX: 9,
};

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

/**
 * Copies the frame in its own pixel format and tags the packet with it.
 *
 * `copyTo({ format })` only converts to RGB formats — asking it for I420 throws
 * NotSupportedError and kills the pipe, which is how every frame of a session
 * was silently lost while audio kept flowing. Let the frame keep its format and
 * let ffmpeg be told what it is.
 */
async function videoPacket(frame: VideoFrame): Promise<ArrayBuffer | undefined> {
  const code = frame.format ? VIDEO_FORMAT_CODES[frame.format] : undefined;
  if (code === undefined) return undefined;
  const size = frame.allocationSize();
  const packet = new Uint8Array(2 + size);
  packet[0] = RAW_VIDEO;
  packet[1] = code;
  await frame.copyTo(packet.subarray(2));
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
  let announcedFormat: string | undefined;
  let unsupported = 0;
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
          const format = value.format ?? 'unknown';
          if (format !== announcedFormat) {
            announcedFormat = format;
            console.log(
              `[compositor] nvenc pipe video format=${format} ` +
                `${value.codedWidth}x${value.codedHeight}`,
            );
          }
          const packet = await videoPacket(value);
          if (packet) {
            ws.send(packet);
          } else if (++unsupported <= 3) {
            console.error(
              `[compositor] nvenc pipe: unsupported VideoFrame format ${format} — dropping frame`,
            );
          }
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

/** Stream canvas frames + mix PCM over the recording WebSocket for ffmpeg NVENC. */
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
