import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream } from 'fs';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { RecordingsService } from './recordings.service';
import { parseRecorderCodec, STREAM_PROFILES, type StreamProfile } from './stream-quality';

/**
 * Binary sink on /ws/recording?room=X&codec=h264|vp9|vp8 — compositor streams
 * MediaRecorder chunks here. File always; RTMP via ffmpeg when live.
 */
@WebSocketGateway({ path: '/ws/recording' })
export class RecordingGateway implements OnGatewayConnection {
  constructor(private readonly recordings: RecordingsService) {}

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const room = url.searchParams.get('room') ?? 'main';
    const codec = parseRecorderCodec(url.searchParams.get('codec'));
    const { file, rtmpUrl, resolution } = this.recordings.getSink(room);
    const profile = STREAM_PROFILES[resolution];
    const out = createWriteStream(file);
    console.log(`[recording] writing ${file} (${resolution}, codec=${codec})`);

    let ffmpeg: ChildProcess | undefined;
    if (rtmpUrl) {
      const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
      const args = buildFfmpegArgs(profile, codec, rtmpUrl);
      ffmpeg = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
      this.recordings.attachFfmpeg(room, ffmpeg);
      ffmpeg.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) console.log(`[ffmpeg:${room}] ${line}`);
      });
      ffmpeg.on('exit', (code, signal) => {
        console.log(`[ffmpeg:${room}] exited code=${code} signal=${signal}`);
      });
      const mode = codec === 'h264' ? 'copy+aac' : `libx264/${profile.ffmpegPreset}`;
      console.log(
        `[recording] live RTMP ${resolution} codec=${codec} mode=${mode} ` +
          `@ ${profile.rtmpVideoBitrate} for room ${room}`,
      );
    }

    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = data as Buffer;
      out.write(buf);
      if (ffmpeg?.stdin && !ffmpeg.stdin.destroyed) {
        ffmpeg.stdin.write(buf);
      }
    });

    socket.on('close', () => {
      out.end();
      if (ffmpeg?.stdin && !ffmpeg.stdin.destroyed) {
        ffmpeg.stdin.end();
      }
      console.log(`[recording] finished ${file}`);
    });
  }
}

function buildFfmpegArgs(profile: StreamProfile, codec: string, rtmpUrl: string): string[] {
  const commonHead = ['-hide_banner', '-loglevel', 'warning', '-fflags', '+genpts', '-i', 'pipe:0'];
  const audio = ['-c:a', 'aac', '-b:a', profile.rtmpAudioBitrate, '-ar', '48000'];
  const out = ['-f', 'flv', rtmpUrl];

  // H.264 from MediaRecorder: copy video, only transcode Opus → AAC for FLV/YouTube.
  if (codec === 'h264') {
    return [...commonHead, '-c:v', 'copy', ...audio, ...out];
  }

  // VP8/VP9 → H.264. medium preset + higher bitrate than the earlier "fast" path.
  return [
    ...commonHead,
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
