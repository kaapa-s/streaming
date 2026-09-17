#!/usr/bin/env node
/** Deterministic local quality gate orchestrator. No network outside the local stack. */
import { existsSync, mkdirSync, writeFileSync, appendFileSync, cpSync, readFileSync } from 'node:fs';
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
const reportSchemaVersion = 'quality-gate/v1';
const checkCatalog = Object.freeze([
  { id: 'preflight.api', meaning: 'API service is reachable' },
  { id: 'preflight.web', meaning: 'Web application is reachable' },
  { id: 'preflight.sfu', meaning: 'SFU service is reachable' },
  { id: 'preflight.compositor', meaning: 'Compositor service is reachable' },
  { id: 'preflight.ffmpeg', meaning: 'ffmpeg executable is available' },
  { id: 'preflight.ffprobe', meaning: 'ffprobe executable is available' },
  { id: 'preflight.node', meaning: 'Node.js executable is available' },
  { id: 'infra.harness-timeout', meaning: 'Browser harness completes within the bounded timeout' },
  { id: 'browser.publish', meaning: 'Two deterministic speakers publish audio and video' },
  { id: 'studio.remote-audio', meaning: 'Remote audio is bidirectional and has no self-feedback' },
  { id: 'compositor.scenes', meaning: 'Compositor scenes and active screen transition satisfy the layout contract' },
  { id: 'recording.output', meaning: 'Local compositor recording satisfies the media contract' },
  { id: 'recording.rtmp', meaning: 'Loopback RTMP output satisfies the H.264/AAC contract' },
]);
const only = new Set(process.argv.flatMap((argument) => argument.startsWith('--only=') ? [argument.slice('--only='.length)] : []));
const catalogIds = new Set(checkCatalog.map((check) => check.id));
const targeted = only.size > 0;
const selected = (id) => !targeted || only.has(id);
const needsHarness = !targeted || [...only].some((id) => !id.startsWith('preflight.'));
if ([...only].some((id) => !catalogIds.has(id))) {
  throw new Error(`Unknown quality-gate check ID: ${[...only].find((id) => !catalogIds.has(id))}`);
}

mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(artifactDir, 'browser.log'), '');
writeFileSync(join(artifactDir, 'browser.error.log'), '');
const add = (id, name, status, extra = {}) => checks.push({
  id,
  name,
  required: true,
  status,
  reason: extra.reason ?? null,
  diagnostic: extra.diagnostic ?? extra.reason ?? (status === 'passed' ? null : `${name} did not satisfy its declared threshold; inspect the listed artifacts and rerun the reproduce command.`),
  measured: extra.measured ?? null,
  threshold: extra.threshold ?? null,
  artifacts: extra.artifacts ?? [],
  reproduce: `QUALITY_GATE_ARTIFACT_DIR=${artifactDir} npm run quality-gate -- --only=${id}`,
  ...extra,
});
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
    const collect = (chunk, file) => { const text = chunk.toString(); output += text; log(file, text); };
    child.stdout.on('data', (chunk) => collect(chunk, 'browser.log'));
    child.stderr.on('data', (chunk) => collect(chunk, 'browser.error.log'));
    const timer = setTimeout(() => { child.kill('SIGTERM'); if (selected('infra.harness-timeout')) add('infra.harness-timeout', 'Harness bounded timeout', 'failed', { measured: { timeoutMs }, threshold: { maxMs: timeoutMs } }); finish({ code: 124, output }); }, timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(timer); finish({ code: code ?? 1, signal, output }); });
  });
}

const servicePreflights = [
  ['preflight.api', 'API reachable', api],
  ['preflight.web', 'Web app reachable', web],
  ['preflight.sfu', 'SFU reachable', sfu],
  ['preflight.compositor', 'Compositor reachable', compositor],
];
const selectedServicePreflights = servicePreflights.filter(([id]) => !targeted || needsHarness || selected(id));
await Promise.all(selectedServicePreflights.map(([id, name, url]) => preflight(id, name, url)));
const toolPreflights = [['ffmpeg', '-version', 'preflight.ffmpeg'], ['ffprobe', '-version', 'preflight.ffprobe'], ['node', '--version', 'preflight.node']];
for (const [command, flag, id] of toolPreflights.filter(([, , checkId]) => !targeted || needsHarness || selected(checkId))) {
  const result = await new Promise((resolveResult) => { const p = spawn(command, [flag], { stdio: 'ignore' }); p.on('error', (error) => resolveResult(error)); p.on('close', (code) => resolveResult(code === 0 ? null : new Error(`exit ${code}`))); });
  add(id, `${command} available`, result ? 'failed' : 'passed', { measured: result ? { error: String(result) } : { available: true }, threshold: { required: true } });
}

const preflightFailures = checks.filter((check) => check.id.startsWith('preflight.') && check.status === 'failed');
const blockedBy = preflightFailures.map((check) => check.id);
let harness = { code: 1, output: '' };
if (needsHarness && blockedBy.length === 0) harness = await runHarness();
const output = harness.output;
const maybeAdd = (id, ...args) => { if (selected(id)) add(id, ...args); };
if (targeted && only.has('infra.harness-timeout') && !checks.some((check) => check.id === 'infra.harness-timeout')) {
  maybeAdd('infra.harness-timeout', 'Harness bounded timeout', blockedBy.length > 0 ? 'blocked' : 'passed', { reason: blockedBy.length > 0 ? `not evaluated: preflight failed (${blockedBy.join(', ')})` : null, measured: { timeoutMs, timedOut: false }, threshold: { maxMs: timeoutMs } });
}
const harnessPassed = harness.code === 0;
const productStatus = blockedBy.length > 0 ? 'blocked' : (harnessPassed && /joined and published audio\/video/.test(output) ? 'passed' : 'failed');
const blockedReason = blockedBy.length > 0 ? `not run: preflight failed (${blockedBy.join(', ')})` : undefined;
maybeAdd('browser.publish', 'Two deterministic speakers publish audio/video', productStatus, { reason: blockedReason, threshold: { speakers: 2, tracksPerSpeaker: { audio: 1, video: 1 } }, artifacts: ['browser.log', 'browser.error.log'] });
const audioLines = [...output.matchAll(/remote audio:\s*(\{.*\})/g)].map((match) => { try { return JSON.parse(match[1]); } catch { return null; } }).filter(Boolean);
maybeAdd('studio.remote-audio', 'Bidirectional remote audio and no self-feedback', blockedBy.length > 0 ? 'blocked' : (harnessPassed && audioLines.length >= 2 ? 'passed' : 'failed'), { reason: blockedReason, measured: audioLines, threshold: { peers: 1, rmsMinimum: 0.002, expectedEnergyMinimum: 0.18, selfLeakageMaximum: 0.08, frequencyToleranceHz: 35 }, artifacts: ['browser.log', 'source-frame-counters.json'] });
const recordingValidationPassed = /RECORDING_VALIDATION_OK/.test(output);
const layoutScenesPassed = /layout snapshots:\s*[1-9]\d*/.test(output);
const layoutEvidencePassed = /layout evidence frames:.*grid-side-by-side/.test(output);
let sceneAudioContract;
try {
  sceneAudioContract = JSON.parse(readFileSync(join(artifactDir, 'layout-scenes.json'), 'utf8')).sceneAudioContract;
} catch {
  sceneAudioContract = null;
}
const sceneAudioContractPassed = Boolean(
  sceneAudioContract?.matched === true &&
  sceneAudioContract.firstActiveSpeaker === 'Bob' &&
  sceneAudioContract.expectedFeaturedId === sceneAudioContract.firstRecordedSceneFeaturedId &&
  JSON.stringify(sceneAudioContract.expectedAudioSourceIds ?? []) ===
    JSON.stringify(sceneAudioContract.firstRecordedSceneAudioSourceIds ?? []),
);
maybeAdd('compositor.scenes', 'All compositor camera presets and active screen transition', blockedBy.length > 0 ? 'blocked' : (harnessPassed && layoutScenesPassed && layoutEvidencePassed && sceneAudioContractPassed ? 'passed' : 'failed'), { reason: blockedReason, measured: { validated: layoutScenesPassed, humanFacingLayoutEvidence: layoutEvidencePassed, sceneAudioContract: sceneAudioContract ?? { matched: false }, presets: ['focus', 'pip-left', 'pip-right', 'grid'], activeScreenTransition: true }, threshold: { presets: ['focus', 'pip-left', 'pip-right', 'grid'], participants: 2, sourcePresence: true, boundedGeometry: true, validDimensions: true, nonBlackSupportingOutput: true, activeTransition: true, humanFacingEvidence: ['layout-focus.png', 'layout-pip-left.png', 'layout-pip-right.png', 'layout-grid-side-by-side.png', 'layout-presentation.png'], sceneAudioAgreement: { firstPhaseSpeaker: 'Bob', firstFeaturedSource: 'Bob camera' } }, artifacts: ['layout-scenes.json', 'layout-frames.json', 'layout-focus.png', 'layout-pip-left.png', 'layout-pip-right.png', 'layout-grid-side-by-side.png', 'layout-presentation.png', 'compositor.session.log', 'recording.output.json', 'media-validation.json'] });
maybeAdd('recording.output', 'Local compositor recording media output', blockedBy.length > 0 ? 'blocked' : (harnessPassed && recordingValidationPassed ? 'passed' : 'failed'), { reason: blockedReason, measured: { recording: output.match(/recording: ([^\n]+)/)?.[1] ?? null, validated: recordingValidationPassed }, threshold: { video: { codec: ['vp8', 'vp9', 'h264'], dimensions: '1920x1080', frames: 30, keyframes: 1, nonBlack: true, phaseCues: ['BOB SOLO', 'ALICE SOLO', 'BOB + ALICE'] }, audio: { codec: ['opus', 'aac'], rmsMinimum: 0.002, tonesHz: [440, 660], stagedPhases: { durationSeconds: 5, analysisWindowSeconds: 1.5, order: ['BOB SOLO', 'ALICE SOLO', 'BOB + ALICE'], activeToneEnergyRatioMinimum: 0.01, inactiveToneEnergyRatioMaximum: 0.035 } }, durationSeconds: { min: 15, max: 30 } }, artifacts: ['browser.log', 'ffprobe.json', 'audio-analysis.json', 'audio-analysis.log', 'phase-analysis.json', 'phase-frames.json', 'phase-1-bob-solo.png', 'phase-2-alice-solo.png', 'phase-3-bob-and-alice.png', 'frame-change-diagnostics.json', 'timestamp-1.png', 'timestamp-4-5.png', 'timestamp-7-5.png', 'timestamp-10.png', 'layout-focus.png', 'layout-pip-left.png', 'layout-pip-right.png', 'layout-grid-side-by-side.png', 'layout-presentation.png', 'layout-frames.json', 'representative-frame.png', 'video-frame-analysis.json', 'media-validation.json', 'source-frame-counters.json'] });
const rtmpValidationPassed = /RTMP_VALIDATION_OK/.test(output);
maybeAdd('recording.rtmp', 'Loopback RTMP H.264/AAC output', blockedBy.length > 0 ? 'blocked' : (harnessPassed && rtmpValidationPassed ? 'passed' : 'failed'), { reason: blockedReason, measured: { validated: rtmpValidationPassed, receiver: output.match(/local RTMP receiver: ([^\n]+)/)?.[1] ?? null }, threshold: { loopbackOnly: true, video: { codec: 'h264', dimensions: '1920x1080', keyframes: 1, frames: 30 }, audio: { codec: 'aac' }, durationSeconds: { min: 15, max: 30 }, payloadBytes: '>0' }, artifacts: ['rtmp/rtmp-received.flv', 'rtmp/rtmp-receiver.log', 'rtmp/ffprobe.json', 'rtmp/media-validation.json', 'rtmp/playback-check.log', 'rtmp/rtmp-validation.json'] });

const orderedChecks = [...checks].sort((left, right) => catalogIds.has(left.id) - catalogIds.has(right.id) || [...catalogIds].indexOf(left.id) - [...catalogIds].indexOf(right.id));
const reportChecks = only.size > 0 ? orderedChecks.filter((check) => only.has(check.id)) : orderedChecks;
const failed = reportChecks.filter((check) => check.status !== 'passed');
const infrastructureFailures = reportChecks.filter((check) => check.status === 'failed' && (check.id.startsWith('preflight.') || check.id === 'infra.harness-timeout'));
const productFailures = reportChecks.filter((check) => check.status === 'failed' && !infrastructureFailures.includes(check));
const recordingPath = output.match(/recording: ([^\n]+)/)?.[1]?.trim();
const sessionLogs = [];
if (recordingPath) {
  const sessionLog = recordingPath.replace(/\.[^.]+$/, '.session.log');
  if (existsSync(sessionLog)) cpSync(sessionLog, join(artifactDir, 'compositor.session.log'));
  if (existsSync(join(artifactDir, 'compositor.session.log'))) sessionLogs.push(join(artifactDir, 'compositor.session.log'));
}
const readableArtifacts = [
  ['report.json', 'versioned gate report'],
  ['media-metadata.json', 'recording contract and fixture metadata'],
  ['browser.log', 'browser harness session log'],
  ['browser.error.log', 'browser harness error log'],
  ['compositor.session.log', 'compositor session log'],
  ['ffprobe.json', 'machine-readable media probe'],
  ['media-validation.json', 'machine-readable recording validation'],
  ['audio-analysis.json', 'RMS and frequency analysis'],
  ['phase-analysis.json', 'staged audio phase analysis'],
  ['phase-frames.json', 'extracted-frame metadata'],
  ['layout-frames.json', 'layout evidence metadata'],
  ['source-frame-counters.json', 'source render counters'],
  ['frame-change-diagnostics.json', 'decoded-frame hashes and timestamps'],
  ['rtmp/ffprobe.json', 'machine-readable RTMP media probe'],
  ['rtmp/media-validation.json', 'machine-readable RTMP validation'],
  ['rtmp/rtmp-validation.json', 'machine-readable RTMP contract result'],
].map(([path, description]) => ({ path: join(artifactDir, path), description }));
const report = {
  schemaVersion: reportSchemaVersion,
  checkCatalogVersion: 'quality-gate/checks-v1',
  checkCatalog,
  runId,
  room: `e2e-${runId}`,
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - Date.parse(startedAt),
  environment: { platform: process.platform, arch: process.arch, node: process.version, cwd: root },
  browser: { version: process.version },
  services: { api, web, sfu, compositor },
  selection: { only: [...only] },
  artifacts: { directory: artifactDir, browserLog: join(artifactDir, 'browser.log'), browserErrorLog: join(artifactDir, 'browser.error.log'), mediaMetadata: join(artifactDir, 'media-metadata.json'), sessionLogs, readable: readableArtifacts },
  outcome: { passed: failed.length === 0, infrastructureFailures: infrastructureFailures.map((check) => check.id), productFailures: productFailures.map((check) => check.id) },
  checks: reportChecks,
  passed: failed.length === 0,
};
writeFileSync(join(artifactDir, 'media-metadata.json'), JSON.stringify({ schemaVersion: 'quality-gate/media-v1', phaseSchedule: { phases: ['BOB SOLO', 'ALICE SOLO', 'BOB + ALICE'], phaseDurationSeconds: 5, analysisWindowSeconds: 1.5, leadInSeconds: 1, visualOnlyCue: true, tonesAudible: true, frameChangeDiagnosticTimestampsSeconds: [1, 4.5, 7.5, 10] }, fixtures: { Alice: { frequencyHz: 440, sourceWidth: 1280, sourceHeight: 720, outputWidth: 1920, outputHeight: 1080, frameRate: 30, counterScope: 'source-canvas-draws' }, Bob: { frequencyHz: 660, sourceWidth: 1280, sourceHeight: 720, outputWidth: 1920, outputHeight: 1080, frameRate: 30, counterScope: 'source-canvas-draws' } } }, null, 2));
for (const check of reportChecks) writeFileSync(join(artifactDir, `${check.id}.json`), JSON.stringify(check, null, 2));
writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
if (process.env.QUALITY_GATE_JSON || process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  console.log(`Quality gate ${report.passed ? 'PASS' : 'FAIL'}`);
  for (const check of reportChecks) {
    const marker = check.status === 'passed' ? 'PASS' : check.status === 'blocked' ? 'BLOCKED' : 'FAIL';
    const detail = check.reason ? ` — ${check.reason}` : '';
    console.log(`  ${marker.padEnd(7)} ${check.id}: ${check.name}${detail}`);
  }
  console.log(`Report: ${join(artifactDir, 'report.json')}`);
}
process.exitCode = report.passed ? 0 : 1;
