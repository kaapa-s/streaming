import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRecording } from './recording-validation.mjs';

/**
 * A one-shot, loopback-only RTMP sink. ffmpeg's RTMP listener is deliberately
 * used instead of a third-party server so the quality gate needs no network,
 * credentials, Docker service, or downloaded fixture.
 */
export async function startLocalRtmpReceiver(artifactDir) {
  const rtmpArtifactDir = join(artifactDir, 'rtmp');
  mkdirSync(rtmpArtifactDir, { recursive: true });
  const port = await freePort();
  const output = join(rtmpArtifactDir, 'rtmp-received.flv');
  const diagnostics = join(rtmpArtifactDir, 'rtmp-receiver.log');
  writeFileSync(diagnostics, '');
  const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-listen', '1',
    '-i', `rtmp://127.0.0.1:${port}/quality-gate`,
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-y', output,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  child.stderr.on('data', (chunk) => append(diagnostics, chunk));
  child.on('error', (error) => append(diagnostics, `${error.stack ?? error}\n`));
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    url: `rtmp://127.0.0.1:${port}/quality-gate/local`,
    output,
    diagnostics,
    process: child,
    async validate() {
      // The RTMP publisher closes its connection when recording stops, but an
      // ffmpeg RTMP listener may keep waiting for another connection. Send its
      // interactive quit command so it writes the FLV trailer before we retain
      // the artifact (SIGTERM here can leave an open-ended FLV).
      await this.stop();
      if (child.exitCode !== 0) {
        throw new Error(`local RTMP receiver exited unsuccessfully (${child.exitCode})`);
      }
      const payloadBytes = statSync(output).size;
      if (payloadBytes <= 0) throw new Error('local RTMP receiver captured an empty payload');
      const result = await validateRecording(output, rtmpArtifactDir);
      const playback = await decodeToEnd(output);
      writeFileSync(join(rtmpArtifactDir, 'rtmp-validation.json'), JSON.stringify({
        url: this.url, output, payloadBytes, playback, ...result.summary,
      }, null, 2));
      return result;
    },
    async stop() {
      if (child.exitCode !== null) return;
      const closed = new Promise((resolve) => child.once('close', resolve));
      if (child.stdin && !child.stdin.destroyed) child.stdin.write('q');
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGTERM');
        setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1_000);
      }, 5_000);
      await closed;
      clearTimeout(timer);
    },
  };
}

function append(file, chunk) {
  // Keep diagnostics available even if ffmpeg exits while the harness is
  // unwinding after a failed browser/recording run.
  appendFileSync(file, chunk);
}
function decodeToEnd(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-map', '0', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const errors = [];
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stderr = Buffer.concat(errors).toString();
      writeFileSync(join(file, '..', 'playback-check.log'), stderr);
      if (code !== 0) reject(new Error(`retained RTMP FLV did not decode to EOF (ffmpeg exit ${code}): ${stderr}`));
      else resolve({ terminated: true, ffmpegExit: code });
    });
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
