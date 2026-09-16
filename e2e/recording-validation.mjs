import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPECTED = { width: 1920, height: 1080, frequencies: [440, 660] };
const PHASES = [
  { name: 'BOB SOLO', active: [660], inactive: [440] },
  { name: 'ALICE SOLO', active: [440], inactive: [660] },
  { name: 'BOB + ALICE', active: [440, 660], inactive: [] },
];
const PHASE_DURATION_SECONDS = 5;
const PHASE_WINDOW_SECONDS = 1.5;
const PHASE_TONE_MINIMUM = 0.01;
const PHASE_TONE_MAXIMUM = 0.035;

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

function cadenceFromTimestamps(timestamps) {
  const ordered = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
  const intervals = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const interval = ordered[index] - ordered[index - 1];
    if (interval > 0 && Number.isFinite(interval)) intervals.push(interval);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const medianInterval = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return {
    measuredFps: medianInterval > 0 ? 1 / medianInterval : 0,
    frameIntervalSeconds: medianInterval,
    minIntervalSeconds: sorted[0] ?? 0,
    maxIntervalSeconds: sorted.at(-1) ?? 0,
    samples: intervals.length,
  };
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
  const overallTones = EXPECTED.frequencies.map((frequency) => ({ frequencyHz: frequency, energyRatio: totalEnergy ? toneEnergy(window, 48000, frequency) / totalEnergy : 0 }));
  const analysis = { sampleRate: 48000, samples: samples.length, durationSeconds: samples.length / 48000, rms, overallTones, thresholds: { rmsMinimum: 0.002, toneEnergyRatioMinimum: 0.01 } };
  const phaseAnalysis = analyzePhases(samples, analysis.durationSeconds);
  // The midpoint may intentionally be Alice-only, so presence of both tones is
  // established by the staged windows rather than the legacy whole-file probe.
  analysis.tones = EXPECTED.frequencies.map((frequency) => ({
    frequencyHz: frequency,
    energyRatio: Math.max(...phaseAnalysis.windows.map((item) => item.energies[frequency] ?? 0)),
  }));
  writeFileSync(join(artifactDir, 'phase-analysis.json'), JSON.stringify(phaseAnalysis, null, 2));
  writeFileSync(join(artifactDir, 'audio-analysis.json'), JSON.stringify({ ...analysis, phases: phaseAnalysis }, null, 2));
  if (rms < analysis.thresholds.rmsMinimum) fail(`mixed audio is silent (rms=${rms})`, analysis);
  const missing = analysis.tones.filter((tone) => tone.energyRatio < analysis.thresholds.toneEnergyRatioMinimum);
  if (missing.length) fail(`expected deterministic audio tone missing: ${missing.map((tone) => tone.frequencyHz).join(', ')}`, analysis);
  analysis.phases = phaseAnalysis;
  return analysis;
}

function analyzePhases(samples, durationSeconds) {
  const rate = 48000;
  const windowSamples = Math.floor(PHASE_WINDOW_SECONDS * rate);
  const candidates = [];
  // Recording and compositor startup can shift the fixture clock. Search a
  // bounded lead-in rather than making the recording timestamp the oracle.
  for (let offset = 0; offset <= 2.5; offset += 0.1) {
    const windows = PHASES.map((phase, index) => {
      const center = offset + index * PHASE_DURATION_SECONDS + PHASE_DURATION_SECONDS / 2;
      const start = Math.floor(center * rate - windowSamples / 2);
      const values = samples.slice(Math.max(0, start), Math.max(0, start) + windowSamples);
      const total = values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length);
      const energies = Object.fromEntries(EXPECTED.frequencies.map((frequency) => [frequency, total ? toneEnergy(values, rate, frequency) / total : 0]));
      return { name: phase.name, centerSeconds: center, energies };
    });
    const score = windows.reduce((sum, measured, index) => {
      const expected = PHASES[index];
      const activeScore = expected.active.reduce((s, frequency) => s + Math.min(1, measured.energies[frequency] / PHASE_TONE_MINIMUM), 0);
      const inactiveScore = expected.inactive.reduce((s, frequency) => s + Math.max(0, 1 - measured.energies[frequency] / PHASE_TONE_MAXIMUM), 0);
      return sum + activeScore + inactiveScore;
    }, 0);
    candidates.push({ offsetSeconds: Number(offset.toFixed(1)), score, windows });
  }
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  const failures = [];
  best.windows.forEach((window, index) => {
    const expected = PHASES[index];
    for (const frequency of expected.active) if (window.energies[frequency] < PHASE_TONE_MINIMUM) failures.push(`${expected.name}: missing ${frequency}Hz`);
    for (const frequency of expected.inactive) if (window.energies[frequency] > PHASE_TONE_MAXIMUM) failures.push(`${expected.name}: unexpected ${frequency}Hz`);
  });
  const result = {
    sequence: PHASES.map(({ name }) => name),
    durationSeconds,
    phaseDurationSeconds: PHASE_DURATION_SECONDS,
    selectedOffsetSeconds: best.offsetSeconds,
    windows: best.windows,
    tolerances: { activeToneEnergyRatioMinimum: PHASE_TONE_MINIMUM, inactiveToneEnergyRatioMaximum: PHASE_TONE_MAXIMUM, offsetSearchSeconds: [0, 2.5] },
    passed: failures.length === 0,
    failures,
  };
  if (failures.length) fail(`staged phase audio contract failed: ${failures.join(', ')}`, result);
  return result;
}

async function extractFrameChangeDiagnostics(file, artifactDir, duration) {
  // These deliberately span repeated and changing cues. Hashing decoded frames
  // proves the file contains changing rendered content without using OCR or
  // making a screenshot a pass/fail visual oracle.
  const requested = [1, 4.5, 7.5, 10].filter((timestamp) => timestamp < duration - 0.1);
  const frames = [];
  for (const timestamp of requested) {
    const output = join(artifactDir, `timestamp-${String(timestamp).replace('.', '-')}.png`);
    const extracted = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-ss', String(timestamp), '-i', file, '-frames:v', '1', '-f', 'image2', output]);
    if (extracted.code !== 0) fail(`timestamp diagnostic frame could not be extracted (${timestamp}s)`, { stderr: extracted.stderr.toString() });
    const data = readFileSync(output);
    frames.push({ requestedTimestampSeconds: timestamp, file: output, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const distinctHashes = new Set(frames.map(({ sha256 }) => sha256)).size;
  const result = { requestedTimestampsSeconds: requested, frames, distinctHashes, changingContent: distinctHashes > 1, interpretation: 'Different decoded-frame hashes demonstrate changing file content; VLC display behavior after seeking is a separate playback/rendering concern.' };
  writeFileSync(join(artifactDir, 'frame-change-diagnostics.json'), JSON.stringify(result, null, 2));
  if (!result.changingContent) fail('decoded timestamp frames did not change', result);
  return result;
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
  const summary = {
    durationSeconds: duration,
    durationSource: durationResult.source,
    video: video && {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      frames: videoFrames.length,
      keyframes: keyframes.length,
      firstTimestamp: timestamps[0],
      lastTimestamp: timestamps.at(-1),
      cadence: cadenceFromTimestamps(timestamps),
    },
    audio: audio && { codec: audio.codec_name, sampleRate: audio.sample_rate, channels: audio.channels },
  };
  writeFileSync(join(artifactDir, 'media-validation.json'), JSON.stringify(summary, null, 2));
  if (!video || !audio) fail('recording must contain both video and audio streams', summary);
  if (!['vp8', 'vp9', 'h264'].includes(video.codec_name) || !['opus', 'aac'].includes(audio.codec_name)) fail('recording has an unsupported codec', summary);
  if (video.width !== EXPECTED.width || video.height !== EXPECTED.height) fail(`invalid video dimensions ${video.width}x${video.height}`, summary);
  if (!(duration >= 15 && duration <= 30) || videoFrames.length < 30 || keyframes.length < 1) fail('invalid duration, frame count, or keyframes', summary);
  if (timestamps.length < 2 || timestamps.some((value, index) => index > 0 && value < timestamps[index - 1])) fail('video timestamps are missing or not monotonic', summary);
  const frame = await extractFrame(file, artifactDir, duration);
  const audioAnalysis = await analyzeAudio(file, artifactDir);
  const phaseFrames = {};
  const phaseOffset = audioAnalysis.phases.selectedOffsetSeconds;
  for (const [index, phase] of PHASES.entries()) {
    const timestamp = phaseOffset + index * PHASE_DURATION_SECONDS + PHASE_DURATION_SECONDS / 2;
    const output = join(artifactDir, `phase-${index + 1}-${phase.name.toLowerCase().replaceAll(' ', '-').replace('+', 'and')}.png`);
    const extracted = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-ss', String(timestamp), '-i', file, '-frames:v', '1', '-f', 'image2', output]);
    if (extracted.code !== 0) fail(`phase cue frame could not be extracted (${phase.name})`, { stderr: extracted.stderr.toString(), timestamp });
    phaseFrames[phase.name] = { timestampSeconds: timestamp, file: output };
  }
  writeFileSync(join(artifactDir, 'phase-frames.json'), JSON.stringify(phaseFrames, null, 2));
  const frameChangeDiagnostics = await extractFrameChangeDiagnostics(file, artifactDir, duration);
  return { summary, frame, audio: audioAnalysis, phaseFrames, frameChangeDiagnostics };
}
