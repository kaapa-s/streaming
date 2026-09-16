import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPECTED = { width: 1920, height: 1080, frequencies: [440, 660] };

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code: code ?? 1, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function toneEnergy(samples, sampleRate, frequency) {
  let cosine = 0; let sine = 0;
  const step = 2 * Math.PI * frequency / sampleRate;
  for (let i = 0; i < samples.length; i += 1) {
    cosine += samples[i] * Math.cos(step * i);
    sine += samples[i] * Math.sin(step * i);
  }
  return 2 * (cosine * cosine + sine * sine) / (samples.length * samples.length);
}

async function analyzeAudio(file, artifactDir) {
  const decoded = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  const log = decoded.stderr.toString();
  writeFileSync(join(artifactDir, 'audio-analysis.log'), log);
  if (decoded.code !== 0 || decoded.stdout.length < 48_000) fail('audio could not be decoded or is too short', { ffmpegExit: decoded.code, stderr: log });
  const values = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, Math.floor(decoded.stdout.length / 4));
  const samples = Array.from(values).filter(Number.isFinite);
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  const window = samples.slice(Math.max(0, Math.floor(samples.length / 2) - 48_000), Math.floor(samples.length / 2) + 48_000);
  const totalEnergy = window.reduce((sum, value) => sum + value * value, 0) / window.length;
  const tones = EXPECTED.frequencies.map((frequency) => ({ frequencyHz: frequency, energyRatio: totalEnergy ? toneEnergy(window, 48000, frequency) / totalEnergy : 0 }));
  const analysis = { sampleRate: 48000, samples: samples.length, durationSeconds: samples.length / 48000, rms, tones, thresholds: { rmsMinimum: 0.002, toneEnergyRatioMinimum: 0.01 } };
  writeFileSync(join(artifactDir, 'audio-analysis.json'), JSON.stringify(analysis, null, 2));
  if (rms < analysis.thresholds.rmsMinimum) fail(`mixed audio is silent (rms=${rms})`, analysis);
  const missing = tones.filter((tone) => tone.energyRatio < analysis.thresholds.toneEnergyRatioMinimum);
  if (missing.length) fail(`expected deterministic audio tone missing: ${missing.map((tone) => tone.frequencyHz).join(', ')}`, analysis);
  return analysis;
}

async function extractFrame(file, artifactDir, duration) {
  const timestamp = Math.max(0, Math.min(duration / 2, duration - 0.1));
  const frame = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-ss', String(timestamp), '-i', file, '-frames:v', '1', '-f', 'image2', join(artifactDir, 'representative-frame.png')]);
  if (frame.code !== 0) fail('representative video frame could not be extracted', { stderr: frame.stderr.toString() });
  const raw = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-ss', String(timestamp), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
  if (raw.code !== 0 || raw.stdout.length === 0) fail('video frame could not be decoded');
  let sum = 0; let variance = 0;
  for (const value of raw.stdout) sum += value;
  const mean = sum / raw.stdout.length;
  for (const value of raw.stdout) variance += (value - mean) ** 2;
  variance /= raw.stdout.length;
  const metrics = { timestampSeconds: timestamp, pixels: raw.stdout.length, meanLuma: mean, lumaVariance: variance, thresholds: { meanLumaMinimum: 2, varianceMinimum: 1 } };
  writeFileSync(join(artifactDir, 'video-frame-analysis.json'), JSON.stringify(metrics, null, 2));
  // A valid scene may be a flat colour; reject black/empty output without
  // requiring pixel-perfect layout variation as an oracle.
  if (mean < 2 || (mean < 8 && variance < 1)) fail('video is black or empty', metrics);
  return metrics;
}

export function deriveDurationSeconds(metadataDuration, timestamps) {
  const explicit = Number(metadataDuration);
  if (Number.isFinite(explicit) && explicit > 0) return { seconds: explicit, source: 'metadata' };
  const ordered = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
  if (ordered.length < 2) return { seconds: 0, source: 'timestamps-unavailable' };
  const deltas = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const delta = ordered[index] - ordered[index - 1];
    if (delta > 0 && Number.isFinite(delta)) deltas.push(delta);
  }
  // Include one frame interval so the duration covers the final decoded frame.
  const frameInterval = deltas.length ? deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : 0;
  return { seconds: ordered.at(-1) - ordered[0] + frameInterval, source: 'video-timestamps' };
}

export async function validateRecording(file, artifactDir) {
  mkdirSync(artifactDir, { recursive: true });
  const probe = await run(process.env.FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_frames', file]);
  const probeText = probe.stdout.toString();
  writeFileSync(join(artifactDir, 'ffprobe.json'), probeText || JSON.stringify({ error: probe.stderr.toString() }, null, 2));
  if (probe.code !== 0) fail('ffprobe rejected recording', { stderr: probe.stderr.toString() });
  let metadata;
  try { metadata = JSON.parse(probeText); } catch { fail('ffprobe did not return JSON'); }
  const streams = metadata.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const videoFrames = (metadata.frames ?? []).filter((frame) => frame.media_type === 'video');
  const keyframes = videoFrames.filter((frame) => frame.key_frame === 1);
  const timestamps = videoFrames.map((frame) => Number(frame.best_effort_timestamp_time ?? frame.pts_time)).filter(Number.isFinite);
  const durationResult = deriveDurationSeconds(metadata.format?.duration ?? video?.duration ?? audio?.duration, timestamps);
  const duration = durationResult.seconds;
  const summary = { durationSeconds: duration, durationSource: durationResult.source, video: video && { codec: video.codec_name, width: video.width, height: video.height, frames: videoFrames.length, keyframes: keyframes.length, firstTimestamp: timestamps[0], lastTimestamp: timestamps.at(-1) }, audio: audio && { codec: audio.codec_name, sampleRate: audio.sample_rate, channels: audio.channels } };
  writeFileSync(join(artifactDir, 'media-validation.json'), JSON.stringify(summary, null, 2));
  if (!video || !audio) fail('recording must contain both video and audio streams', summary);
  if (!['vp8', 'vp9', 'h264'].includes(video.codec_name) || !['opus', 'aac'].includes(audio.codec_name)) fail('recording has an unsupported codec', summary);
  if (video.width !== EXPECTED.width || video.height !== EXPECTED.height) fail(`invalid video dimensions ${video.width}x${video.height}`, summary);
  if (!(duration >= 3 && duration <= 30) || videoFrames.length < 30 || keyframes.length < 1) fail('invalid duration, frame count, or keyframes', summary);
  if (timestamps.length < 2 || timestamps.some((value, index) => index > 0 && value < timestamps[index - 1])) fail('video timestamps are missing or not monotonic', summary);
  const frame = await extractFrame(file, artifactDir, duration);
  const audioAnalysis = await analyzeAudio(file, artifactDir);
  return { summary, frame, audio: audioAnalysis };
}
