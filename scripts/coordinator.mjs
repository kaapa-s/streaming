#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const issueId = process.argv.find((value) => value.startsWith('--issue='))?.slice('--issue='.length);
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`;
const artifactDir = resolve(process.env.COORDINATOR_ARTIFACT_DIR ?? join(root, 'e2e', 'coordinator-artifacts', runId));
const worktreeDir = root;
const branchName = `agent/${issueId ?? 'issue'}-${runId}`;
const model = process.env.OPENROUTER_MODEL ?? 'openrouter/openrouter/auto';
const openRouterKeyFile = process.env.OPENROUTER_API_KEY_FILE ?? '/Users/kaapa/dev/openrouter';
const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? (existsSync(openRouterKeyFile) ? readFileSync(openRouterKeyFile, 'utf8').trim() : '');
const timeoutMs = Number(process.env.COORDINATOR_TIMEOUT_MS ?? 1_200_000);
const defaultVerifyCommands = ['npm run lint --prefix server', 'npm run typecheck --prefix server', 'npm run test --prefix server', 'npm run lint --prefix sfu', 'npm run typecheck --prefix sfu', 'npm run lint --prefix web', 'npm run lint --prefix compositor', 'npm run typecheck --prefix compositor', 'npm run test --prefix compositor', 'npm run quality-gate'];
const verifyCommands = (process.env.COORDINATOR_VERIFY_COMMANDS ?? defaultVerifyCommands.join(';;')).split(';;').map((value) => value.trim()).filter(Boolean);
const escalationEnabled = process.env.COORDINATOR_ESCALATION !== '0';
const protectedPatterns = [/^scripts\/quality-gate\.mjs$/, /^scripts\/quality-agent\.mjs$/, /^scripts\/coordinator\.mjs$/, /^scripts\/plan\.mjs$/, /^e2e\//, /(^|\/)(test|tests|__tests__)\//, /\.(test|spec)\.[^/]+$/, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/, /(^|\/)(\.env|\.env\..*)$/, /\.(pem|key|p12)$/];
const steps = [];
const children = new Set();
let issue = null;
let escalator = null;
let finalDiff = '';
let isolator = null;
let branchCreated = false;
let stoppedBy = null;
let worker = null;
let handoffWritten = false;

mkdirSync(artifactDir, { recursive: true });
const log = (message) => appendFileSync(join(artifactDir, 'coordinator.log'), `${new Date().toISOString()} ${message}\n`);
const record = (name, status, detail = null) => { const step = { name, status, detail, startedAt: new Date().toISOString() }; steps.push(step); log(`${name}: ${status}${detail ? ` ${detail}` : ''}`); return step; };

function parseJson(value, label) {
  try { return JSON.parse(value); } catch (error) { throw new Error(`${label} did not return JSON: ${error.message}`); }
}

function commandParts(command) {
  const parts = command.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ?? [];
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

function run(command, args = [], cwd = root, env = {}, limit = timeoutMs) {
  return new Promise((finish) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (code, signal) => { if (!settled) { settled = true; clearTimeout(timer); children.delete(child); try { child.kill('SIGKILL'); } catch {} finish({ code, signal, stdout, stderr }); } };
    const timer = setTimeout(() => { stderr += '\nTimed out after ' + limit + 'ms\n'; settle(124, 'SIGTERM'); }, limit);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { stderr += `${error}\n`; settle(1, null); });
    child.on('close', (code, signal) => settle(code ?? 1, signal));
  });
}

function killChildren(signal = 'SIGTERM') {
  for (const child of [...children]) {
    try { process.kill(-child.pid, signal); } catch {}
    try { child.kill(signal); } catch {}
  }
}

async function runProcessGroup(command, args, cwd, env = {}, limit = timeoutMs) {
  return new Promise((finish) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const terminateGroup = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
    const settle = (code, signal) => { if (!settled) { settled = true; clearTimeout(timer); terminateGroup(); children.delete(child); finish({ code, signal, stdout, stderr }); } };
    const timer = setTimeout(() => { stderr += '\nTimed out after ' + limit + 'ms\n'; terminateGroup(); settle(124, 'SIGTERM'); }, limit);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { stderr += `${error}\n`; settle(1, null); });
    child.on('close', (code, signal) => settle(code ?? 1, signal));
  });
}

const runGroup = runProcessGroup;

async function bd(args) {
  const result = await run('bd', [...args, '--json', '--readonly']);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return parseJson(result.stdout, `bd ${args.join(' ')}`);
}

function promptFor(role, extra = {}) {
  return JSON.stringify({ role, issue, runId, artifactDir:relative(root, artifactDir), checkout: relative(root, worktreeDir), allowedProductPaths: ['server/', 'sfu/', 'web/', 'compositor/', 'shared/', 'scripts/'], protectedPatterns, ...extra });
}

async function runWorker(role, agent, cwd) {
  const target = process.env.COORDINATOR_HERDR_TARGET;
  const env = openRouterApiKey ? { OPENROUTER_API_KEY: openRouterApiKey } : {};
  if (target) {
    const result = await runGroup('herdr', ['agent', 'prompt', target, promptFor(role), '--wait', '--timeout', String(timeoutMs)], cwd, env);
    return { kind: 'herdr', target, ...result };
  }
  const result = await runGroup(process.env.OPENCODE_BIN ?? 'opencode', ['run', '--agent', agent, '--model', model, '--format', 'json', '--auto', promptFor(role)], cwd, env);
  return { kind: 'opencode', target: null, ...result };
}

async function git(cwd, args) {
  return run('git', args, cwd);
}

async function implementedDiff(cwd) {
  const diff = await git(cwd, ['diff', '--binary', 'HEAD']);
  return { code: diff.code, text: diff.stdout || diff.stderr };
}

async function stagedDiff(cwd) {
  await git(cwd, ['add', '-A']);
  const diff = await git(cwd, ['diff', '--binary', '--cached']);
  return { code: diff.code, text: diff.stdout || diff.stderr };
}

async function changedPaths(cwd) {
  const result = await git(cwd, ['diff', '--name-only', 'HEAD']);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim().split('\n').sort() : [];
}

async function isolationConfirmed(cwd) {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0 || resolve(result.stdout.trim()) !== resolve(cwd)) throw new Error(`worktree isolation check failed: ${result.stderr || result.stdout}`);
  isolator = { checkout: resolve(cwd), verifiedAt: new Date().toISOString() };
  return isolator;
}

async function annotateReview(review, cwd) {
  writeFileSync(join(artifactDir, 'reviewer.json'), JSON.stringify(review, null, 2));
  const lines = Array.isArray(review.stdout) ? review.stdout : String(review.stdout ?? '').trim().split('\n');
  const jsonObjects = [];
  for (const line of lines) {
    try { jsonObjects.push(JSON.parse(line)); } catch {}
  }
  const payload = jsonObjects.find((parsed) => parsed && (parsed.status || parsed.findings || parsed.remarks));
  const remarks = payload && (payload.remarks ?? payload.summary) ? (payload.remarks ?? payload.summary) : (review.stdout ?? review.stderr ?? '');
  writeFileSync(join(artifactDir, 'review-remarks.txt'), `${remarks}\n`);
  review.remarks = remarks;
  return payload ?? null;
}

async function pipeline() {
  if (!issueId) throw new Error('Usage: npm run run-issue -- --issue=<id>');
  const payload = await bd(['show', issueId]);
  issue = Array.isArray(payload) ? payload[0] : payload;
  if (!issue?.id) throw new Error(`Issue not found: ${issueId}`);
  if (!['open', 'in_progress'].includes(issue.status)) throw new Error(`Issue ${issueId} is not executable in status ${issue.status}`);
  writeFileSync(join(artifactDir, 'issue.json'), JSON.stringify(issue, null, 2));

  const status = await git(root, ['status', '--porcelain']);
  if (status.code !== 0) throw new Error(`repository status failed: ${status.stderr || status.stdout}`);
  if (status.stdout.trim()) throw new Error('local main must be clean before starting a branch run');
  const currentBranch = await git(root, ['branch', '--show-current']);
  if (currentBranch.code !== 0 || currentBranch.stdout.trim() !== 'main') throw new Error(`branch run must start from local main, found ${currentBranch.stdout.trim() || 'detached HEAD'}`);

  record('branch', 'running');
  const created = await git(root, ['switch', '-c', branchName, 'main']);
  writeFileSync(join(artifactDir, 'branch.log'), `${created.stdout}${created.stderr}`);
  if (created.code !== 0) throw new Error(`branch creation failed: ${created.stderr || created.stdout}`);
  branchCreated = true;
  await isolationConfirmed(worktreeDir);
  record('branch', 'passed', branchName);

  record('implementer', 'running');
  worker = await runWorker('implementer', 'implementer', worktreeDir);
  writeFileSync(join(artifactDir, 'implementer.json'), JSON.stringify(worker, null, 2));
  if (worker.code !== 0) { record('implementer', 'failed', worker.stderr || worker.stdout); stoppedBy = 'implementer'; return; }
  // Stage the implementation so brand-new untracked files are included in the
  // patch, the changed-path set, and the protected-path guard.
  await git(worktreeDir, ['add', '-A']);
  const implementDiff = await implementedDiff(worktreeDir);
  writeFileSync(join(artifactDir, 'implement.patch'), implementDiff.text);
  record('implementer', 'passed', `${(await changedPaths(worktreeDir)).length} changed path(s), diff ${implementDiff.text.length} bytes`);

  const paths = await changedPaths(worktreeDir);
  writeFileSync(join(artifactDir, 'changed-paths.json'), JSON.stringify(paths, null, 2));
  const violations = protectedViolations(paths);
  if (violations.length) { record('protected-path-guard', 'failed', violations.join(', ')); stoppedBy = 'protected-path-guard'; return; }
  record('protected-path-guard', 'passed', `${paths.length} changed path(s)`);

  record('reviewer', 'running');
  const review = await runWorker('reviewer', 'reviewer', worktreeDir);
  const reviewPayload = await annotateReview(review, worktreeDir);
  const reviewFailed = review.code !== 0 || reviewPayload?.status === 'failed';
  if (reviewFailed) { record('reviewer', 'failed', review.stderr || reviewPayload?.summary || reviewPayload?.findings || review.stdout); stoppedBy = 'reviewer'; return; }
  record('reviewer', 'passed');

  for (const command of verifyCommands) {
    const parts = commandParts(command);
    const name = `verifier:${command}`;
    record(name, 'running');
    const result = await runGroup(parts[0], parts.slice(1), worktreeDir, { QUALITY_GATE_ARTIFACT_DIR: join(artifactDir, 'quality-gate') });
    writeFileSync(join(artifactDir, `${steps.length}-verifier.json`), JSON.stringify(result, null, 2));
    if (result.code !== 0) { record(name, 'failed', (result.stderr || result.stdout).slice(0, 2000)); stoppedBy = 'verifier'; return; }
    record(name, 'passed');
  }

  const gateSteps = steps.filter((step) => step.name === 'verifier:npm run quality-gate');
  const gateStep = gateSteps.at(-1);
  if (gateStep && gateStep.status !== 'passed') throw new Error(`quality gate failed: ${gateStep.detail ?? 'see artifacts'}`);
  record('quality-gate-handoff', 'passed');
}

async function escalate() {
  if (!escalationEnabled) return { status: 'skipped', reason: 'COORDINATOR_ESCALATION=0' };
  record('escalation', 'running');
  const agentCommand = commandParts(process.env.QUALITY_AGENT_COMMAND ?? 'node scripts/quality-agent.mjs');
  const result = await runGroup(agentCommand[0], agentCommand.slice(1), worktreeDir, {
    QUALITY_AGENT_ARTIFACT_DIR: artifactDir,
    QUALITY_AGENT_TRIGGER_ISSUE: issueId,
    QUALITY_AGENT_MAX_RUNS: process.env.QUALITY_AGENT_MAX_RUNS ?? '1',
    OPENROUTER_MODEL: model,
    ...(openRouterApiKey ? { OPENROUTER_API_KEY: openRouterApiKey } : {}),
  });
  let payload = null;
  const lines = String(result.stdout ?? '').trim().split('\n');
  for (const line of lines.reverse()) {
    try { const parsed = JSON.parse(line); if (parsed && parsed.schemaVersion === 'quality-agent/v1') { payload = parsed; break; } } catch {}
  }
  escalator = { status: result.code === 0 ? 'passed' : 'failed', exitCode: result.code, payload, stderr: result.stderr };
  record('escalation', escalator.status, payload ? `classification=${payload.classification} passed=${payload.passed} escalation=${payload.escalation?.status}` : (result.stderr || result.stdout).slice(0, 2000));
}

async function obtainFinalDiff(cwd) {
  const staged = await stagedDiff(cwd);
  writeFileSync(join(artifactDir, 'final.patch'), staged.text);
  finalDiff = staged.text;
  return staged;
}

function protectedViolations(paths) { return paths.filter((path) => protectedPatterns.some((pattern) => pattern.test(path))); }

async function handoff(status, summary, blocker = 'none') {
  const paths = existsSync(join(artifactDir, 'changed-paths.json')) ? JSON.parse(readFileSync(join(artifactDir, 'changed-paths.json'), 'utf8')) : [];
  const checks = steps.map((step) => `${step.name}:${step.status}`).join(' | ');
  const classifier = (escalator && escalator.payload && escalator.payload.classification) ? ` classifier=${escalator.payload.classification}` : '';
  const text = [`STATUS: ${status}`, `ISSUE: ${issueId}`, `SUMMARY: ${summary}`, `CHANGED: ${paths.join(', ') || 'none'}`, `CHECKS: ${checks}${classifier}`, `BLOCKER: ${blocker}`, `DECISION: ${status === 'NEEDS_DECISION' ? 'review artifacts at ' + artifactDir + '; classify as product or gate defect' : 'none'}`, `NEXT: Inspect ${artifactDir} and manually test the retained branch ${branchName}.`].join('\n');
  writeFileSync(join(artifactDir, 'handoff.txt'), `${text}\n`);
  const result = await run('bd', ['comment', issueId, text, '--json']);
  writeFileSync(join(artifactDir, 'handoff-result.json'), JSON.stringify(result, null, 2));
  if (result.code !== 0) throw new Error(`Beads handoff failed: ${result.stderr || result.stdout}`);
  handoffWritten = true;
}

async function cleanup() {
  killChildren();
  if (branchCreated) writeFileSync(join(artifactDir, 'cleanup.json'), JSON.stringify({ branch: branchName, retained: true }, null, 2));
}

async function listSupervised() {
  const result = await git(root, ['worktree', 'list', '--porcelain']);
  return result.code === 0 ? result.stdout.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.split(' ')[1]) : [];
}

function attachSignals() {
  process.on('SIGINT', () => {
    stoppedBy = stoppedBy ?? 'SIGINT';
    killChildren();
  });
  process.on('SIGTERM', () => {
    stoppedBy = stoppedBy ?? 'SIGTERM';
    killChildren();
  });
}

let outcome = 'passed';
try {
  attachSignals();
  await pipeline();
  if (stoppedBy) outcome = 'blocked';
  if (steps.some((step) => step.name.startsWith('verifier:') && step.status === 'failed') && escalationEnabled) {
    try {
      await escalate();
    } catch (error) {
      record('escalation', 'failed', String(error));
      escalator = { status: 'failed', error: String(error) };
    }
  }
  if (branchCreated) await obtainFinalDiff(worktreeDir);
  const summary = outcome === 'passed' ? `Coordinator pipeline completed; no commit, push, or issue closure performed.` : `Coordinator stopped at ${stoppedBy}; artifacts preserved for human decision.`;
  await handoff(outcome === 'passed' ? 'DONE' : 'NEEDS_DECISION', summary, stoppedBy ?? 'none');
} catch (error) {
  outcome = 'blocked';
  stoppedBy = stoppedBy ?? 'coordinator';
  record('coordinator', 'failed', String(error));
  process.exitCode = 1;
  if (issue && !handoffWritten) {
    try {
      await handoff('NEEDS_DECISION', `Coordinator failed before completing the pipeline; artifacts preserved for human decision.`, stoppedBy);
    } catch (handoffError) {
      log(`handoff failed: ${handoffError}`);
    }
  }
} finally {
  try { await cleanup(); } catch {}
  const supervised = await listSupervised();
  const report = { schemaVersion: 'coordinator/v1', runId, issue: issueId, outcome, stoppedBy, artifactDir, branchName, checkout: worktreeDir, isolator, worker, escalator, steps, controlledWorktrees: supervised, branchRetained: branchCreated };
  writeFileSync(join(artifactDir, 'run-report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (outcome !== 'passed') process.exitCode = 1;
}