import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream } from 'fs';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { RecordingsService } from './recordings.service';
import { STREAM_PROFILES } from './stream-quality';

/**
 * Binary sink on /ws/recording?room=X — the compositor page streams
 * MediaRecorder webm chunks here; they are appended to a file and, when an
 * RTMP URL was provided at start, also piped through ffmpeg to YouTube Live.
 */
@WebSocketGateway({ path: '/ws/recording' })
export class RecordingGateway implements OnGatewayConnection {
  constructor(private readonly recordings: RecordingsService) {}

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const room = url.searchParams.get('room') ?? 'main';
    const { file, rtmpUrl, resolution } = this.recordings.getSink(room);
    const profile = STREAM_PROFILES[resolution];
    const out = createWriteStream(file);
    console.log(`[recording] writing ${file} (${resolution})`);

    let ffmpeg: ChildProcess | undefined;
    if (rtmpUrl) {
      const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
      // Re-encode VP8/VP9+Opus → H.264+AAC for YouTube. Prefer quality over
      // the previous zerolatency/veryfast settings (double-encode already hurts).
      ffmpeg = spawn(
        bin,
        [
          '-hide_banner',
          '-loglevel',
          'warning',
          '-fflags',
          '+genpts',
          '-i',
          'pipe:0',
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
          '-c:a',
          'aac',
          '-b:a',
          profile.rtmpAudioBitrate,
          '-ar',
          '48000',
          '-f',
          'flv',
          rtmpUrl,
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      this.recordings.attachFfmpeg(room, ffmpeg);
      ffmpeg.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) console.log(`[ffmpeg:${room}] ${line}`);
      });
      ffmpeg.on('exit', (code, signal) => {
        console.log(`[ffmpeg:${room}] exited code=${code} signal=${signal}`);
      });
      console.log(
        `[recording] live RTMP ${resolution} @ ${profile.rtmpVideoBitrate} ` +
          `(preset ${profile.ffmpegPreset}) for room ${room}`,
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
