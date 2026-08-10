import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream } from 'fs';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { SessionsService } from '../sessions/sessions.service';
import type { SessionLog } from './session-log';
import { redactRtmp } from './rtmp';
import { parseRecorderCodec, STREAM_PROFILES, type StreamProfile } from '@streaming/stream-quality';

/**
 * Binary sink on /ws/recording?room=X&codec=h264|vp9|vp8 — compositor streams
 * MediaRecorder chunks here. File always; RTMP via ffmpeg when live.
 */
@WebSocketGateway({ path: '/ws/recording' })
export class RecordingGateway implements OnGatewayConnection {
  constructor(private readonly sessions: SessionsService) {}

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const room = url.searchParams.get('room') ?? 'main';
    const codec = parseRecorderCodec(url.searchParams.get('codec'));

    let sink;
    try {
      sink = this.sessions.getSink(room);
    } catch (err) {
      console.error(`[recording] reject sink for room ${room}:`, err);
      socket.close();
      return;
    }

    const { file, rtmpUrl, resolution, sessionLog } = sink;
    const profile = STREAM_PROFILES[resolution];

    if (rtmpUrl && codec !== 'h264') {
      const msg =
        `live RTMP requires H.264 recorder output (got ${codec}) — ` +
        'refusing sink to avoid libx264 re-encode';
      console.error(`[recording] ${msg} room=${room}`);
      sessionLog?.write(msg);
      socket.close();
      return;
    }

    const out = createWriteStream(file);
    let bytesIn = 0;
    let chunkCount = 0;
    let windowBytes = 0;
    let windowChunks = 0;
    let windowStartedAt = Date.now();

    console.log(`[recording] writing ${file} (${resolution}, codec=${codec})`);
    sessionLog?.write(`sink connected codec=${codec} resolution=${resolution} file=${file}`);

    let ffmpeg: ChildProcess | undefined;
    if (rtmpUrl) {
      const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
      const args = buildFfmpegArgs(profile, codec, rtmpUrl);
      ffmpeg = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
      this.sessions.attachFfmpeg(room, ffmpeg);
      attachFfmpegLogging(room, ffmpeg, sessionLog);
      const mode = codec === 'h264' ? 'copy+aac' : `libx264/${profile.ffmpegPreset}`;
      const banner =
        `live RTMP ${resolution} codec=${codec} mode=${mode} ` +
        `@ ${profile.rtmpVideoBitrate} for room ${room}`;
      console.log(`[recording] ${banner}`);
      sessionLog?.write(banner);
      sessionLog?.write(
        `ffmpeg args: ${args.map((a) => (/^rtmps?:\/\//i.test(a) ? redactRtmp(a) : a)).join(' ')}`,
      );
    }

    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = data as Buffer;
      bytesIn += buf.length;
      chunkCount += 1;
      windowBytes += buf.length;
      windowChunks += 1;
      out.write(buf);
      if (ffmpeg?.stdin && !ffmpeg.stdin.destroyed) {
        const ok = ffmpeg.stdin.write(buf);
        if (!ok) sessionLog?.write('ffmpeg stdin backpressure (write returned false)');
      }
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

    socket.on('close', () => {
      out.end();
      if (ffmpeg?.stdin && !ffmpeg.stdin.destroyed) {
        ffmpeg.stdin.end();
      }
      sessionLog?.write(`sink closed chunks=${chunkCount} total_bytes=${bytesIn}`);
      console.log(`[recording] finished ${file}`);
    });
  }
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

function buildFfmpegArgs(profile: StreamProfile, codec: string, rtmpUrl: string): string[] {
  const commonHead = [
    '-hide_banner',
    '-loglevel',
    'info',
    '-stats_period',
    '5',
    '-fflags',
    '+genpts',
    '-i',
    'pipe:0',
  ];
  const audio = [
    '-c:a',
    'aac',
    '-b:a',
    profile.rtmpAudioBitrate,
    '-ar',
    '48000',
    '-ac',
    '2',
  ];
  const out = ['-f', 'flv', rtmpUrl];

  if (codec === 'h264') {
    return [
      ...commonHead,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'copy',
      ...audio,
      ...out,
    ];
  }

  return [
    ...commonHead,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    profile.ffmpegPreset,
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(profile.fps * 2),
    '-keyint_min',
    String(profile.fps * 2),
    '-sc_threshold',
    '0',
    '-b:v',
    profile.rtmpVideoBitrate,
    '-maxrate',
    profile.rtmpMaxrate,
    '-bufsize',
    profile.rtmpBufsize,
    ...audio,
    ...out,
  ];
}
