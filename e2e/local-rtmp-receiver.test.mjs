import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startLocalRtmpReceiver } from './local-rtmp-receiver.mjs';

function run(command, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); });
  });
}

test('loopback RTMP receiver gracefully terminates a retained FLV', async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'streaming-rtmp-'));
  const receiver = await startLocalRtmpReceiver(artifactDir);
  try {
    const sender = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-f', 'flv', receiver.url,
    ]);
    assert.equal(sender.code, 0, sender.stderr.toString());
    await receiver.stop();
    assert.equal(receiver.process.exitCode, 0);

    const payload = await stat(receiver.output);
    assert.ok(payload.size > 0, 'receiver must retain a non-empty FLV');
    const probe = await run(process.env.FFPROBE_PATH ?? 'ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', receiver.output,
    ]);
    assert.equal(probe.code, 0, probe.stderr.toString());
    const metadata = JSON.parse(probe.stdout);
    assert.equal(metadata.streams.find((stream) => stream.codec_type === 'video')?.codec_name, 'h264');
    assert.equal(metadata.streams.find((stream) => stream.codec_type === 'audio')?.codec_name, 'aac');

    const playback = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [
      '-hide_banner', '-v', 'error', '-i', receiver.output, '-map', '0', '-f', 'null', '-',
    ]);
    assert.equal(playback.code, 0, playback.stderr.toString());

    // Regress the original symptom directly when ffplay is installed. The
    // timeout makes a broken/open-ended FLV fail the test instead of hanging.
    const ffplay = await run(process.env.FFPLAY_PATH ?? 'ffplay', [
      '-nodisp', '-autoexit', '-loglevel', 'error', receiver.output,
    ], 10_000).catch(() => null);
    if (ffplay) assert.equal(ffplay.code, 0, ffplay.stderr.toString());
  } finally {
    await receiver.stop();
  }
});
