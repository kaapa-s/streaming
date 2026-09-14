import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream } from 'fs';
import type { IncomingMessage } from 'http';
import type { Writable } from 'stream';
import type { WebSocket } from 'ws';
import { SessionsService } from '../sessions/sessions.service';
import type { SessionLog } from './session-log';
import { buildNvencFfmpegArgs } from './nvenc';
import { frameSize, parseRawPacket, type VideoFormat } from './raw-pipe';
import { buildFfmpegArgs, redactFfmpegArg } from './rtmp';
import { parseRecorderCodec, STREAM_PROFILES } from '@streaming/stream-quality';

/** Audio held while waiting for the first video frame (~5s at 48kHz stereo f32). */
const MAX_PENDING_AUDIO_BYTES = 4_000_000;

/** How long to wait for a first video frame before saying so in the log. */
const VIDEO_WAIT_WARN_MS = 10_000;

/**
 * Binary sink on /ws/recording?room=X&codec=h264|vp9|vp8|raw — compositor streams
 * MediaRecorder chunks (or raw frames + PCM for NVENC) here. File always; RTMP via ffmpeg when live.
 */
@WebSocketGateway({ path: '/ws/recording' })
export class RecordingGateway implements OnGatewayConnection {
  constructor(private readonly sessions: SessionsService) {}

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const room = url.searchParams.get('room') ?? 'main';
    const codecParam = url.searchParams.get('codec');
    const raw = codecParam === 'raw';
    const codec = raw ? 'h264' : parseRecorderCodec(codecParam);

    let sink;
    try {
      sink = this.sessions.getSink(room);
    } catch (err) {
      console.error(`[recording] reject sink for room ${room}:`, err);
      socket.close();
      return;
    }

    const { file, rtmpUrls, resolution, sessionLog } = sink;
    const profile = STREAM_PROFILES[resolution];
    const live = rtmpUrls.length > 0;

    if (live && !raw && codec !== 'h264') {
      const msg =
        `live RTMP requires H.264 recorder output (got ${codec}) — ` +
        'refusing sink to avoid libx264 re-encode';
      console.error(`[recording] ${msg} room=${room}`);
      sessionLog?.write(msg);
      socket.close();
      return;
    }

    if (raw) {
      this.handleRawNvenc(socket, {
        room,
        file,
        rtmpUrls,
        sessionLog,
        live,
        resolution,
      });
      return;
    }

    const out = createWriteStream(file);
    out.on('error', (err) => {
      sessionLog?.write(`recording file error: ${String(err)}`);
      console.error(`[recording:${room}] file error:`, err);
    });
    let bytesIn = 0;
    let chunkCount = 0;
    let windowBytes = 0;
    let windowChunks = 0;
    let windowStartedAt = Date.now();

    console.log(`[recording] writing ${file} (${resolution}, codec=${codec})`);
    sessionLog?.write(`sink connected codec=${codec} resolution=${resolution} file=${file}`);

    let ffmpeg: ChildProcess | undefined;
    if (live) {
      const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
      const args = buildFfmpegArgs(profile, codec, rtmpUrls);
      ffmpeg = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
      this.sessions.attachFfmpeg(room, ffmpeg);
      guardFfmpegPipes(room, ffmpeg, sessionLog);
      attachFfmpegLogging(room, ffmpeg, sessionLog);
      const mode = codec === 'h264' ? 'copy+aac' : `libx264/${profile.ffmpegPreset}`;
      const banner =
        `live RTMP ${resolution} codec=${codec} mode=${mode} ` +
        `destinations=${rtmpUrls.length} @ ${profile.rtmpVideoBitrate} for room ${room}`;
      console.log(`[recording] ${banner}`);
      sessionLog?.write(banner);
      sessionLog?.write(`ffmpeg args: ${args.map(redactFfmpegArg).join(' ')}`);
    }

    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = data as Buffer;
      bytesIn += buf.length;
      chunkCount += 1;
      windowBytes += buf.length;
      windowChunks += 1;
      out.write(buf);
      writePipe(ffmpeg?.stdin, buf, sessionLog, 'stdin');
      const now = Date.now();
      const elapsedMs = now - windowStartedAt;
      if (elapsedMs >= 10_000) {
        const kbps = ((windowBytes * 8) / (elapsedMs / 1000) / 1000).toFixed(0);
        sessionLog?.write(
          `ingress window_s=${(elapsedMs / 1000).toFixed(1)} chunks=${windowChunks} ` +
            `bytes=${windowBytes} kbps=${kbps} total_chunks=${chunkCount} total_bytes=${bytesIn}`,
        );
        windowBytes = 0;
        windowChunks = 0;
        windowStartedAt = now;
      }
    });

    socket.on('error', (err) => {
      sessionLog?.write(`sink socket error: ${String(err)}`);
      console.error(`[recording:${room}] sink socket error:`, err);
    });

    socket.on('close', () => {
      out.end();
      endPipe(ffmpeg?.stdin);
      sessionLog?.write(`sink closed chunks=${chunkCount} total_bytes=${bytesIn}`);
      console.log(`[recording] finished ${file}`);
    });
  }

  /**
   * ffmpeg is spawned on the first video frame, not on connect: only the frame
   * knows its pixel format, and `-f rawvideo` has to be told the right one.
   * Audio arrives first and is held until then.
   */
  private handleRawNvenc(
    socket: WebSocket,
    opts: {
      room: string;
      file: string;
      rtmpUrls: string[];
      sessionLog: SessionLog | undefined;
      live: boolean;
      resolution: '1080p';
    },
  ): void {
    const { room, file, rtmpUrls, sessionLog, live, resolution } = opts;
    const profile = STREAM_PROFILES[resolution];
    const mode = live ? 'nvenc+aac+tee' : 'nvenc+webm';

    sessionLog?.write(`sink connected codec=raw resolution=${resolution} file=${file}`);

    let ffmpeg: ChildProcess | undefined;
    let audioIn: Writable | undefined;
    let format: VideoFormat | undefined;
    let expectedVideo = 0;
    let pendingAudio: Buffer[] = [];
    let pendingAudioBytes = 0;
    let droppedAudio = 0;

    let bytesIn = 0;
    let videoFrames = 0;
    let audioPackets = 0;
    let skippedVideo = 0;
    let windowBytes = 0;
    let windowStartedAt = Date.now();

    const waitWarning = setTimeout(() => {
      if (ffmpeg) return;
      const msg =
        `no video frame after ${VIDEO_WAIT_WARN_MS / 1000}s — ffmpeg not started, ` +
        `audio_packets=${audioPackets}. The page is not delivering frames.`;
      sessionLog?.write(msg);
      console.error(`[recording:${room}] ${msg}`);
    }, VIDEO_WAIT_WARN_MS);

    const startFfmpeg = (videoFormat: VideoFormat): ChildProcess => {
      format = videoFormat;
      expectedVideo = frameSize(videoFormat, profile.width, profile.height);
      const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
      const args = buildNvencFfmpegArgs(profile, file, rtmpUrls, videoFormat.pixFmt);
      ffmpeg = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
      this.sessions.attachFfmpeg(room, ffmpeg);
      guardFfmpegPipes(room, ffmpeg, sessionLog);
      attachFfmpegLogging(room, ffmpeg, sessionLog);
      audioIn = extraStdin(ffmpeg, 3);

      const banner =
        `NVENC ${resolution} mode=${mode} file=${file} ` +
        `format=${videoFormat.name} pix_fmt=${videoFormat.pixFmt} ` +
        `destinations=${rtmpUrls.length} @ ${profile.rtmpVideoBitrate} for room ${room}`;
      console.log(`[recording] ${banner}`);
      sessionLog?.write(banner);
      sessionLog?.write(`ffmpeg args: ${args.map(redactFfmpegArg).join(' ')}`);

      for (const chunk of pendingAudio) writePipe(audioIn, chunk, sessionLog, 'audio');
      if (droppedAudio > 0) {
        sessionLog?.write(`dropped ${droppedAudio} buffered audio packets before first video frame`);
      }
      pendingAudio = [];
      pendingAudioBytes = 0;
      return ffmpeg;
    };

    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const packet = parseRawPacket(buf);
      if (!packet) return;
      bytesIn += packet.payload.length;
      windowBytes += packet.payload.length;

      if (packet.kind === 'video') {
        let target = ffmpeg;
        if (!target) {
          clearTimeout(waitWarning);
          target = startFfmpeg(packet.format);
        } else if (packet.format.name !== format?.name) {
          skippedVideo += 1;
          if (skippedVideo <= 3) {
            sessionLog?.write(
              `nvenc skip video format=${packet.format.name} expected=${format?.name} ` +
                '(pixel format cannot change mid-stream)',
            );
          }
          return;
        }
        if (packet.payload.length !== expectedVideo) {
          skippedVideo += 1;
          if (skippedVideo <= 3 || skippedVideo % 120 === 0) {
            sessionLog?.write(
              `nvenc skip video bytes=${packet.payload.length} expected=${expectedVideo} n=${skippedVideo}`,
            );
          }
          return;
        }
        videoFrames += 1;
        writePipe(target.stdin, packet.payload, sessionLog, 'video');
      } else {
        audioPackets += 1;
        if (!ffmpeg) {
          // Held until the first video frame names the pixel format.
          if (pendingAudioBytes + packet.payload.length > MAX_PENDING_AUDIO_BYTES) {
            droppedAudio += 1;
          } else {
            pendingAudio.push(Buffer.from(packet.payload));
            pendingAudioBytes += packet.payload.length;
          }
        } else {
          writePipe(audioIn, packet.payload, sessionLog, 'audio');
        }
      }

      const now = Date.now();
      const elapsedMs = now - windowStartedAt;
      if (elapsedMs >= 10_000) {
        const kbps = ((windowBytes * 8) / (elapsedMs / 1000) / 1000).toFixed(0);
        sessionLog?.write(
          `nvenc ingress window_s=${(elapsedMs / 1000).toFixed(1)} ` +
            `video_frames=${videoFrames} audio_packets=${audioPackets} ` +
            `kbps=${kbps} total_bytes=${bytesIn}`,
        );
        windowBytes = 0;
        windowStartedAt = now;
      }
    });

    socket.on('error', (err) => {
      sessionLog?.write(`sink socket error: ${String(err)}`);
      console.error(`[recording:${room}] sink socket error:`, err);
    });

    socket.on('close', () => {
      clearTimeout(waitWarning);
      endPipe(ffmpeg?.stdin);
      endPipe(audioIn);
      if (!ffmpeg) {
        const msg = 'sink closed before any video frame — nothing was encoded';
        sessionLog?.write(msg);
        console.error(`[recording:${room}] ${msg}`);
      }
      sessionLog?.write(
        `sink closed codec=raw video_frames=${videoFrames} audio_packets=${audioPackets} ` +
          `skipped_video=${skippedVideo} total_bytes=${bytesIn}`,
      );
      console.log(`[recording] finished ${file} (nvenc)`);
    });
  }
}

function extraStdin(child: ChildProcess, fd: number): Writable | undefined {
  const stream = child.stdio[fd];
  if (stream && typeof stream === 'object' && 'write' in stream) {
    return stream as Writable;
  }
  return undefined;
}

function writePipe(
  dest: Writable | null | undefined,
  payload: Buffer,
  sessionLog: SessionLog | undefined,
  label: string,
): void {
  if (!dest || dest.destroyed || dest.writableEnded) return;
  try {
    const ok = dest.write(payload);
    if (!ok) sessionLog?.write(`ffmpeg ${label} backpressure (write returned false)`);
  } catch (err) {
    sessionLog?.write(`ffmpeg ${label} write failed: ${String(err)}`);
  }
}

function endPipe(dest: Writable | null | undefined): void {
  if (!dest || dest.destroyed || dest.writableEnded) return;
  try {
    dest.end();
  } catch {
    // The pipe is already gone; ffmpeg exiting is handled by its own listener.
  }
}

/**
 * An ffmpeg that dies mid-session resets its stdio pipes. Without a listener,
 * that ECONNRESET/EPIPE is an unhandled 'error' event, which takes the whole
 * compositor process down with it — every in-flight session, plus the HTTP
 * server, so `/internal/rooms/:slug/stop` then answers 502 from nginx.
 */
function guardFfmpegPipes(
  room: string,
  ffmpeg: ChildProcess,
  sessionLog: SessionLog | undefined,
): void {
  const guard = (stream: { on?: (ev: string, cb: (err: Error) => void) => unknown } | null | undefined, label: string) => {
    stream?.on?.('error', (err: Error) => {
      sessionLog?.write(`ffmpeg ${label} pipe error: ${String(err)}`);
      console.error(`[ffmpeg:${room}] ${label} pipe error: ${String(err)}`);
    });
  };
  guard(ffmpeg.stdin, 'stdin');
  guard(ffmpeg.stdout, 'stdout');
  guard(ffmpeg.stderr, 'stderr');
  guard(extraStdin(ffmpeg, 3), 'fd3');
  ffmpeg.on('error', (err) => {
    sessionLog?.write(`ffmpeg process error: ${String(err)}`);
    console.error(`[ffmpeg:${room}] process error: ${String(err)}`);
  });
}

function attachFfmpegLogging(
  room: string,
  ffmpeg: ChildProcess,
  sessionLog: SessionLog | undefined,
): void {
  let stderrBuf = '';
  ffmpeg.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const parts = stderrBuf.split(/\r?\n/);
    stderrBuf = parts.pop() ?? '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      sessionLog?.write(`ffmpeg: ${trimmed}`);
      if (/error|warn|speed=|drop|fail|queue|delay|past duration/i.test(trimmed)) {
        console.log(`[ffmpeg:${room}] ${trimmed}`);
      }
    }
  });
  ffmpeg.on('exit', (code, signal) => {
    if (stderrBuf.trim()) sessionLog?.write(`ffmpeg: ${stderrBuf.trim()}`);
    const msg = `ffmpeg exited code=${code} signal=${signal}`;
    console.log(`[ffmpeg:${room}] ${msg}`);
    sessionLog?.write(msg);
  });
}
