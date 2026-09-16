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
      cwd: root, env: { ...process.env, E2E_ARTIFACT_DIR: artifactRoot, E2E_RUN_ID: runId },
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
add('studio.remote-audio', 'Bidirectional remote audio and no self-feedback', blockedBy.length > 0 ? 'blocked' : (harnessPassed && audioLines.length >= 2 ? 'passed' : 'failed'), { reason: blockedReason, measured: audioLines, threshold: { peers: 1, rmsMinimum: 0.002, expectedEnergyMinimum: 0.18, selfLeakageMaximum: 0.08, frequencyToleranceHz: 35 }, artifacts: ['browser.log'] });
add('recording.output', 'Local compositor recording output', blockedBy.length > 0 ? 'blocked' : (harnessPassed && /recording: .*\([\d.]+ KiB\)/.test(output) ? 'passed' : 'failed'), { reason: blockedReason, measured: { recording: output.match(/recording: (.*)/)?.[1] ?? null }, threshold: { minBytes: 200000 }, artifacts: ['browser.log'] });

const failed = checks.filter((check) => check.status !== 'passed');
const infrastructureFailures = checks.filter((check) => check.status === 'failed' && (check.id.startsWith('preflight.') || check.id === 'infra.harness-timeout'));
const productFailures = checks.filter((check) => check.status === 'failed' && !infrastructureFailures.includes(check));
const recordingPath = output.match(/recording: ([^\n]+?) \([\d.]+ KiB\)/)?.[1];
const sessionLogs = [];
if (recordingPath) {
  const sessionLog = recordingPath.replace(/\.[^.]+$/, '.session.log');
  if (existsSync(sessionLog)) { cpSync(sessionLog, join(artifactDir, 'compositor.session.log')); sessionLogs.push(join(artifactDir, 'compositor.session.log')); }
}
const report = { schemaVersion: 'quality-gate/v1', runId, room: `e2e-${runId}`, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), browser: { version: process.version }, services: { api, web, sfu, compositor }, artifacts: { directory: artifactDir, browserLog: join(artifactDir, 'browser.log'), browserErrorLog: join(artifactDir, 'browser.error.log'), mediaMetadata: join(artifactDir, 'media-metadata.json'), sessionLogs }, outcome: { passed: failed.length === 0, infrastructureFailures: infrastructureFailures.map((check) => check.id), productFailures: productFailures.map((check) => check.id) }, checks, passed: failed.length === 0 };
writeFileSync(join(artifactDir, 'media-metadata.json'), JSON.stringify({ schemaVersion: 'quality-gate/media-v1', fixtures: { Alice: { frequencyHz: 440, width: 1280, height: 720, frameRate: 30 }, Bob: { frequencyHz: 660, width: 1280, height: 720, frameRate: 30 } } }, null, 2));
for (const check of checks) writeFileSync(join(artifactDir, `${check.id}.json`), JSON.stringify(check, null, 2));
writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
if (process.env.QUALITY_GATE_JSON || process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`); else console.log(`Quality gate ${report.passed ? 'PASS' : 'FAIL'} — report: ${join(artifactDir, 'report.json')}`);
process.exitCode = report.passed ? 0 : 1;
