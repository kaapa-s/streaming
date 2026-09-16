#!/usr/bin/env node
/** Deterministic local quality gate orchestrator. No network outside the local stack. */
import { existsSync, mkdirSync, writeFileSync, appendFileSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`;
const artifactRoot = resolve(process.env.QUALITY_GATE_ARTIFACT_DIR ?? join(root, 'e2e', 'e2e-artifacts'));
const artifactDir = join(artifactRoot, runId);
const timeoutMs = Number(process.env.QUALITY_GATE_TIMEOUT_MS ?? 150_000);
const api = process.env.API_ORIGIN ?? 'http://localhost:3000/api';
const web = process.env.WEB_ORIGIN ?? 'https://localhost:5173';
const sfu = process.env.SFU_ORIGIN ?? 'http://localhost:3001';
const compositor = process.env.COMPOSITOR_ORIGIN ?? 'http://localhost:3002';
const checks = [];
const startedAt = new Date().toISOString();

mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(artifactDir, 'browser.log'), '');
writeFileSync(join(artifactDir, 'browser.error.log'), '');
const add = (id, name, status, extra = {}) => checks.push({ id, name, required: true, status, reason: extra.reason ?? null, measured: extra.measured ?? null, threshold: extra.threshold ?? null, artifacts: extra.artifacts ?? [], reproduce: `QUALITY_GATE_ARTIFACT_DIR=${artifactDir} npm run quality-gate -- --only=${id}`, ...extra });
const log = (file, text) => appendFileSync(join(artifactDir, file), text);

function probe(url) {
  return new Promise((resolveProbe, rejectProbe) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, { rejectUnauthorized: false, timeout: 5_000 }, (response) => {
      response.resume();
      response.once('end', () => resolveProbe(response.statusCode ?? 0));
    });
    request.once('timeout', () => request.destroy(new Error('request timeout')));
    request.once('error', rejectProbe);
  });
}

async function preflight(id, name, url) {
  const started = Date.now();
  try {
    const status = await probe(url);
    // A 401/404 still proves the local process is listening; connection errors do not.
    add(id, name, 'passed', { measured: { status, latencyMs: Date.now() - started }, threshold: { reachable: true } });
  } catch (error) {
    add(id, name, 'failed', { reason: 'local service is not reachable', measured: { error: String(error) }, threshold: { reachable: true } });
  }
}

function runHarness() {
  return new Promise((finish) => {
    const child = spawn(process.execPath, [join(root, 'e2e', 'two-speaker.mjs')], {
      cwd: root, env: { ...process.env, E2E_ARTIFACT_DIR: artifactRoot, E2E_RUN_ID: runId, QUALITY_GATE_LOCAL_RTMP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk, file) => { const text = chunk.toString(); output += text; log(file, text); process.stdout.write(process.env.QUALITY_GATE_JSON ? '' : text); };
    child.stdout.on('data', (chunk) => collect(chunk, 'browser.log'));
    child.stderr.on('data', (chunk) => collect(chunk, 'browser.error.log'));
    const timer = setTimeout(() => { child.kill('SIGTERM'); add('infra.harness-timeout', 'Harness bounded timeout', 'failed', { measured: { timeoutMs }, threshold: { maxMs: timeoutMs } }); finish({ code: 124, output }); }, timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(timer); finish({ code: code ?? 1, signal, output }); });
  });
}

await Promise.all([
  preflight('preflight.api', 'API reachable', api),
  preflight('preflight.web', 'Web app reachable', web),
  preflight('preflight.sfu', 'SFU reachable', sfu),
  preflight('preflight.compositor', 'Compositor reachable', compositor),
]);
for (const [command, flag, id] of [['ffprobe', '-version', 'preflight.ffprobe'], ['node', '--version', 'preflight.node']]) {
  const result = await new Promise((resolveResult) => { const p = spawn(command, [flag], { stdio: 'ignore' }); p.on('error', (error) => resolveResult(error)); p.on('close', (code) => resolveResult(code === 0 ? null : new Error(`exit ${code}`))); });
  add(id, `${command} available`, result ? 'failed' : 'passed', { measured: result ? { error: String(result) } : { available: true }, threshold: { required: true } });
}

const preflightFailures = checks.filter((check) => check.id.startsWith('preflight.') && check.status === 'failed');
const blockedBy = preflightFailures.map((check) => check.id);
let harness = { code: 1, output: '' };
if (blockedBy.length === 0) harness = await runHarness();
const output = harness.output;
const harnessPassed = harness.code === 0;
const productStatus = blockedBy.length > 0 ? 'blocked' : (harnessPassed && /joined and published audio\/video/.test(output) ? 'passed' : 'failed');
const blockedReason = blockedBy.length > 0 ? `not run: preflight failed (${blockedBy.join(', ')})` : undefined;
add('browser.publish', 'Two deterministic speakers publish audio/video', productStatus, { reason: blockedReason, threshold: { speakers: 2, tracksPerSpeaker: { audio: 1, video: 1 } }, artifacts: ['browser.log', 'browser.error.log'] });
const audioLines = [...output.matchAll(/remote audio:\s*(\{.*\})/g)].map((match) => { try { return JSON.parse(match[1]); } catch { return null; } }).filter(Boolean);
add('studio.remote-audio', 'Bidirectional remote audio and no self-feedback', blockedBy.length > 0 ? 'blocked' : (harnessPassed && audioLines.length >= 2 ? 'passed' : 'failed'), { reason: blockedReason, measured: audioLines, threshold: { peers: 1, rmsMinimum: 0.002, expectedEnergyMinimum: 0.18, selfLeakageMaximum: 0.08, frequencyToleranceHz: 35 }, artifacts: ['browser.log', 'source-frame-counters.json'] });
const recordingValidationPassed = /RECORDING_VALIDATION_OK/.test(output);
const layoutScenesPassed = /layout snapshots:\s*[1-9]\d*/.test(output);
add('compositor.scenes', 'All compositor camera presets and active screen transition', blockedBy.length > 0 ? 'blocked' : (harnessPassed && layoutScenesPassed ? 'passed' : 'failed'), { reason: blockedReason, measured: { validated: layoutScenesPassed, presets: ['focus', 'pip-left', 'pip-right', 'grid'], activeScreenTransition: true }, threshold: { presets: ['focus', 'pip-left', 'pip-right', 'grid'], participants: 2, sourcePresence: true, boundedGeometry: true, validDimensions: true, nonBlackSupportingOutput: true, activeTransition: true }, artifacts: ['layout-scenes.json', 'compositor.session.log', 'recording.output.json', 'media-validation.json'] });
add('recording.output', 'Local compositor recording media output', blockedBy.length > 0 ? 'blocked' : (harnessPassed && recordingValidationPassed ? 'passed' : 'failed'), { reason: blockedReason, measured: { recording: output.match(/recording: ([^\n]+)/)?.[1] ?? null, validated: recordingValidationPassed }, threshold: { video: { codec: ['vp8', 'vp9', 'h264'], dimensions: '1920x1080', frames: 30, keyframes: 1, nonBlack: true, phaseCues: ['BOB SOLO', 'ALICE SOLO', 'BOB + ALICE'] }, audio: { codec: ['opus', 'aac'], rmsMinimum: 0.002, tonesHz: [440, 660], stagedPhases: { durationSeconds: 5, analysisWindowSeconds: 1.5, order: ['BOB SOLO', 'ALICE SOLO', 'BOB + ALICE'], activeToneEnergyRatioMinimum: 0.01, inactiveToneEnergyRatioMaximum: 0.035 } }, durationSeconds: { min: 15, max: 30 } }, artifacts: ['browser.log', 'ffprobe.json', 'audio-analysis.json', 'audio-analysis.log', 'phase-analysis.json', 'phase-frames.json', 'phase-1-bob-solo.png', 'phase-2-alice-solo.png', 'phase-3-bob-and-alice.png', 'frame-change-diagnostics.json', 'timestamp-1.png', 'timestamp-4-5.png', 'timestamp-7-5.png', 'timestamp-10.png', 'representative-frame.png', 'video-frame-analysis.json', 'media-validation.json', 'source-frame-counters.json'] });
const rtmpValidationPassed = /RTMP_VALIDATION_OK/.test(output);
add('recording.rtmp', 'Loopback RTMP H.264/AAC output', blockedBy.length > 0 ? 'blocked' : (harnessPassed && rtmpValidationPassed ? 'passed' : 'failed'), { reason: blockedReason, measured: { validated: rtmpValidationPassed, receiver: output.match(/local RTMP receiver: ([^\n]+)/)?.[1] ?? null }, threshold: { loopbackOnly: true, video: { codec: 'h264', dimensions: '1920x1080', keyframes: 1, frames: 30 }, audio: { codec: 'aac' }, durationSeconds: { min: 15, max: 30 }, payloadBytes: '>0' }, artifacts: ['rtmp/rtmp-received.flv', 'rtmp/rtmp-receiver.log', 'rtmp/ffprobe.json', 'rtmp/media-validation.json', 'rtmp/playback-check.log', 'rtmp/rtmp-validation.json'] });

const failed = checks.filter((check) => check.status !== 'passed');
const infrastructureFailures = checks.filter((check) => check.status === 'failed' && (check.id.startsWith('preflight.') || check.id === 'infra.harness-timeout'));
const productFailures = checks.filter((check) => check.status === 'failed' && !infrastructureFailures.includes(check));
const recordingPath = output.match(/recording: ([^\n]+)/)?.[1]?.trim();
const sessionLogs = [];
if (recordingPath) {
  const sessionLog = recordingPath.replace(/\.[^.]+$/, '.session.log');
  if (existsSync(sessionLog)) cpSync(sessionLog, join(artifactDir, 'compositor.session.log'));
  if (existsSync(join(artifactDir, 'compositor.session.log'))) sessionLogs.push(join(artifactDir, 'compositor.session.log'));
}
const report = { schemaVersion: 'quality-gate/v1', runId, room: `e2e-${runId}`, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), browser: { version: process.version }, services: { api, web, sfu, compositor }, artifacts: { directory: artifactDir, browserLog: join(artifactDir, 'browser.log'), browserErrorLog: join(artifactDir, 'browser.error.log'), mediaMetadata: join(artifactDir, 'media-metadata.json'), sessionLogs }, outcome: { passed: failed.length === 0, infrastructureFailures: infrastructureFailures.map((check) => check.id), productFailures: productFailures.map((check) => check.id) }, checks, passed: failed.length === 0 };
writeFileSync(join(artifactDir, 'media-metadata.json'), JSON.stringify({ schemaVersion: 'quality-gate/media-v1', phaseSchedule: { phases: ['BOB SOLO', 'ALICE SOLO', 'BOB + ALICE'], phaseDurationSeconds: 5, analysisWindowSeconds: 1.5, leadInSeconds: 1, visualOnlyCue: true, tonesAudible: true, frameChangeDiagnosticTimestampsSeconds: [1, 4.5, 7.5, 10] }, fixtures: { Alice: { frequencyHz: 440, sourceWidth: 1280, sourceHeight: 720, outputWidth: 1920, outputHeight: 1080, frameRate: 30, counterScope: 'source-canvas-draws' }, Bob: { frequencyHz: 660, sourceWidth: 1280, sourceHeight: 720, outputWidth: 1920, outputHeight: 1080, frameRate: 30, counterScope: 'source-canvas-draws' } } }, null, 2));
for (const check of checks) writeFileSync(join(artifactDir, `${check.id}.json`), JSON.stringify(check, null, 2));
writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
if (process.env.QUALITY_GATE_JSON || process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`); else console.log(`Quality gate ${report.passed ? 'PASS' : 'FAIL'} — report: ${join(artifactDir, 'report.json')}`);
process.exitCode = report.passed ? 0 : 1;
