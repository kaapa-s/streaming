#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const planPath = process.argv.find((value) => value.startsWith('--plan='))?.slice('--plan='.length);
const artifactRoot = resolve(process.env.SWARM_ARTIFACT_DIR ?? join(root, 'e2e', 'swarm-artifacts', `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`));
const concurrency = Number(process.env.SWARM_CONCURRENCY ?? 2);
const timeoutMs = Number(process.env.SWARM_TIMEOUT_MS ?? 1_800_000);
const coordinator = resolve(process.env.SWARM_COORDINATOR ?? join(root, 'scripts', 'coordinator.mjs'));
const children = new Set();
const startedAt = new Date().toISOString();

function fail(message) {
  throw new Error(message);
}

function loadPlan() {
  if (!planPath) fail('Usage: npm run swarm -- --plan=<plan-v1.json>');
  const target = resolve(planPath);
  if (!existsSync(target)) fail(`Plan not found: ${target}`);
  let plan;
  try { plan = JSON.parse(readFileSync(target, 'utf8')); } catch (error) { fail(`Plan is not valid JSON: ${error.message}`); }
  if (plan?.schemaVersion !== 'plan/v1') fail(`Unsupported plan schema: ${plan?.schemaVersion ?? 'missing'}`);
  if (!Array.isArray(plan.waves) || !Array.isArray(plan.ownership)) fail('Plan must contain waves and ownership arrays');
  if (plan.conflicts?.length) fail(`Plan contains ${plan.conflicts.length} ownership conflict(s)`);
  if (plan.missingDependencies?.length) fail(`Plan contains ${plan.missingDependencies.length} missing dependency finding(s)`);
  return { plan, target };
}

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function pathsConflict(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validatePlan(plan) {
  const ownership = new Map(plan.ownership.map((claim) => [claim.issue, (claim.paths ?? []).map(normalizePath)]));
  const seen = new Set();
  const waves = [...plan.waves].sort((left, right) => left.index - right.index);
  if (waves.some((wave, index) => wave.index !== index + 1)) fail('Plan waves must have contiguous indexes starting at 1');
  for (const wave of waves) {
    if (!Array.isArray(wave.issues) || wave.issues.length === 0) fail(`Wave ${wave.index} has no issues`);
    if (wave.status !== 'ready') fail(`Wave ${wave.index} is not ready`);
    for (const issue of wave.issues) {
      if (seen.has(issue)) fail(`Issue ${issue} appears in more than one wave`);
      seen.add(issue);
    }
    const claims = wave.issues.flatMap((issue) => (ownership.get(issue) ?? []).map((path) => ({ issue, path })));
    for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
        if (pathsConflict(claims[leftIndex].path, claims[rightIndex].path)) {
          fail(`File conflict in wave ${wave.index}: ${claims[leftIndex].issue} and ${claims[rightIndex].issue} claim ${claims[leftIndex].path} and ${claims[rightIndex].path}`);
        }
      }
    }
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) fail('SWARM_CONCURRENCY must be a positive integer');
  return { ownership, waves };
}

function killChildren(signal = 'SIGTERM') {
  for (const child of [...children]) {
    try { process.kill(-child.pid, signal); } catch {}
    try { child.kill(signal); } catch {}
  }
}

function runIssue(issue, waveIndex, index) {
  const issueArtifactDir = join(artifactRoot, `wave-${waveIndex}`, issue);
  mkdirSync(issueArtifactDir, { recursive: true });
  const issueStartedAt = new Date().toISOString();
  return new Promise((finish) => {
    const child = spawn(process.execPath, [coordinator, `--issue=${issue}`], {
      cwd: root,
      env: { ...process.env, COORDINATOR_ARTIFACT_DIR: issueArtifactDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    children.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (code, signal, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      writeFileSync(join(issueArtifactDir, 'swarm-stdout.log'), stdout);
      writeFileSync(join(issueArtifactDir, 'swarm-stderr.log'), stderr);
      finish({ issue, wave: waveIndex, index, status: code === 0 ? 'passed' : 'failed', exitCode: code ?? 1, signal, timedOut, startedAt: issueStartedAt, finishedAt: new Date().toISOString(), artifactDir: issueArtifactDir });
    };
    const timer = setTimeout(() => {
      stderr += `Timed out after ${timeoutMs}ms\n`;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      settle(124, 'SIGTERM', true);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { stderr += `${error}\n`; settle(1, null); });
    child.on('close', (code, signal) => settle(code ?? 1, signal));
  });
}

async function runWave(wave) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < wave.issues.length) {
      const index = next;
      next += 1;
      results[index] = await runIssue(wave.issues[index], wave.index, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, wave.issues.length) }, () => worker()));
  return results;
}

let outcome = 'passed';
let failure = null;
let report;
try {
  const { plan, target } = loadPlan();
  const { waves } = validatePlan(plan);
  mkdirSync(artifactRoot, { recursive: true });
  const waveResults = [];
  for (const wave of waves) {
    const results = await runWave(wave);
    const passed = results.every((result) => result.status === 'passed');
    waveResults.push({ index: wave.index, issues: wave.issues, status: passed ? 'passed' : 'failed', startedAt: results[0]?.startedAt ?? new Date().toISOString(), finishedAt: results.at(-1)?.finishedAt ?? new Date().toISOString(), results });
    if (!passed) {
      outcome = 'needs_decision';
      failure = { wave: wave.index, failedIssues: results.filter((result) => result.status !== 'passed').map((result) => result.issue), reason: 'wave failure halted downstream dispatch' };
      break;
    }
  }
  report = { schemaVersion: 'swarm/v1', plan: target, issue: plan.issue ?? null, concurrency, timeoutMs, startedAt, finishedAt: new Date().toISOString(), outcome, failure, waves: waveResults, artifactDir: artifactRoot, downstreamWavesSkipped: waves.slice(waveResults.length).map((wave) => wave.index) };
} catch (error) {
  outcome = 'needs_decision';
  failure = { reason: error.message };
  report = { schemaVersion: 'swarm/v1', plan: planPath ? resolve(planPath) : null, concurrency, timeoutMs, startedAt, finishedAt: new Date().toISOString(), outcome, failure, waves: [], artifactDir: artifactRoot, downstreamWavesSkipped: [] };
  process.exitCode = 1;
} finally {
  killChildren();
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, 'swarm-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  appendFileSync(join(artifactRoot, 'swarm.log'), `${JSON.stringify(report)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.outcome !== 'passed') process.exitCode = 1;
}
