#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`;
const artifactDir = resolve(process.env.QUALITY_AGENT_ARTIFACT_DIR ?? join(root, 'e2e', 'quality-agent-artifacts', runId));
const maxRuns = Number(process.env.QUALITY_AGENT_MAX_RUNS ?? 3);
const model = process.env.OPENROUTER_MODEL ?? 'openrouter/auto';
const apiKey = process.env.OPENROUTER_API_KEY;
const allowedRoots = ['server/', 'sfu/', 'web/', 'compositor/', 'shared/', 'scripts/'];
const protectedPatterns = [
  /^scripts\/quality-gate\.mjs$/,
  /^scripts\/quality-agent\.mjs$/,
  /^e2e\//,
  /(^|\/)(test|tests|__tests__)\//,
  /\.(test|spec)\.[^/]+$/,
];

mkdirSync(artifactDir, { recursive: true });
const actions = [];
const log = (message) => {
  actions.push(message);
  appendFileSync(join(artifactDir, 'agent.log'), `${new Date().toISOString()} ${message}\n`);
};
const parseArg = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const gateCommand = parseArg('--gate-command', 'npm run quality-gate');
const triggeringIssue = process.env.QUALITY_AGENT_TRIGGER_ISSUE ?? parseArg('--issue', '');

function run(command, args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code, signal) => resolveRun({ code: code ?? 1, signal, stdout, stderr }));
    child.on('error', (error) => resolveRun({ code: 1, signal: null, stdout, stderr: `${stderr}${error}\n` }));
  });
}

function parseGateReport(stdout) {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      const report = JSON.parse(line);
      if (report?.schemaVersion === 'quality-gate/v1') return report;
    } catch {}
  }
  return null;
}

function readableArtifacts(report) {
  const files = [
    ...(report?.artifacts?.readable ?? []).map((entry) => entry.path),
    report?.artifacts?.browserLog,
    report?.artifacts?.browserErrorLog,
  ].filter(Boolean);
  return files.filter((file) => existsSync(file)).map((file) => {
    const content = readFileSync(file, 'utf8');
    return { path: relative(root, file), content: content.length > 20_000 ? content.slice(-20_000) : content };
  });
}

function failedChecks(report) {
  return (report?.checks ?? []).filter((check) => check.status !== 'passed').map((check) => ({
    id: check.id,
    status: check.status,
    reason: check.reason,
    diagnostic: check.diagnostic,
    measured: check.measured,
    threshold: check.threshold,
    reproduce: check.reproduce,
    artifacts: check.artifacts,
  }));
}

async function askAgent(report, artifacts) {
  if (!apiKey) return { classification: 'environment-infra', summary: 'OPENROUTER_API_KEY is not configured', actions: [], patch: '', hypotheses: ['Configure OPENROUTER_API_KEY before running diagnosis.'] };
  const prompt = {
    task: 'Diagnose a deterministic local streaming quality-gate failure. Return JSON only.',
    rules: [
      'The quality gate is the only pass/fail oracle.',
      'Classify as exactly one of product-bug, suspected-test-issue, environment-infra, or flake.',
      'Only product-bug may include a patch.',
      'The patch must be a standard unified diff with paths under server/, sfu/, web/, compositor/, shared/, or scripts/.',
      'Never patch scripts/quality-gate.mjs, e2e/, tests, test files, package lockfiles, or configuration secrets.',
      'Prefer no patch when evidence is insufficient.',
    ],
    outputSchema: { classification: 'string', summary: 'string', actions: ['string'], patch: 'unified diff string', hypotheses: ['string'] },
    report: { schemaVersion: report?.schemaVersion, runId: report?.runId, outcome: report?.outcome, checks: failedChecks(report) },
    artifacts,
  };
  const response = await fetch(process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'streaming quality verification agent' },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You are a bounded diagnosis agent. Do not invent evidence.' }, { role: 'user', content: JSON.stringify(prompt) }] }),
  });
  if (!response.ok) throw new Error(`OpenRouter request failed with HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no diagnosis content');
  const diagnosis = JSON.parse(content);
  if (!['product-bug', 'suspected-test-issue', 'environment-infra', 'flake'].includes(diagnosis.classification)) throw new Error('OpenRouter returned an invalid classification');
  return { classification: diagnosis.classification, summary: String(diagnosis.summary ?? ''), actions: Array.isArray(diagnosis.actions) ? diagnosis.actions.map(String) : [], patch: typeof diagnosis.patch === 'string' ? diagnosis.patch : '', hypotheses: Array.isArray(diagnosis.hypotheses) ? diagnosis.hypotheses.map(String) : [] };
}

function patchPaths(patch) {
  return [...patch.matchAll(/^(?:\+\+\+|---) (?:a\/|b\/)?([^\t\n]+)$/gm)].map((match) => match[1]);
}

function validatePatch(patch) {
  if (!patch.trim()) return { valid: false, reason: 'no patch supplied' };
  if (!patch.includes('diff --git ')) return { valid: false, reason: 'patch is not a git unified diff' };
  const paths = patchPaths(patch);
  if (paths.length === 0) return { valid: false, reason: 'patch contains no file paths' };
  for (const file of paths) {
    if (!allowedRoots.some((prefix) => file.startsWith(prefix)) || protectedPatterns.some((pattern) => pattern.test(file))) return { valid: false, reason: `path is outside the product allowlist: ${file}` };
  }
  return { valid: true, paths: [...new Set(paths)] };
}

async function applyPatch(patch) {
  const validation = validatePatch(patch);
  if (!validation.valid) return validation;
  const patchPath = join(artifactDir, 'proposed.patch');
  writeFileSync(patchPath, patch);
  const check = await run('git', ['apply', '--check', '--whitespace=nowarn', patchPath]);
  if (check.code !== 0) return { valid: false, reason: `git apply --check failed: ${check.stderr || check.stdout}` };
  const applied = await run('git', ['apply', '--whitespace=nowarn', patchPath]);
  if (applied.code !== 0) return { valid: false, reason: `git apply failed: ${applied.stderr || applied.stdout}` };
  log(`Applied product patch to ${validation.paths.join(', ')}`);
  return validation;
}

async function fileEscalation(finalReport, finalDiagnosis) {
  const failed = failedChecks(finalReport);
  const issueComment = [
    `Quality agent run ${runId}: ${finalDiagnosis?.classification ?? classification}.`,
    `Checks: ${failed.map((check) => check.id).join(', ') || 'none reported'}.`,
    `Artifacts: ${artifactDir}.`,
    `Summary: ${finalDiagnosis?.summary ?? 'The gate did not pass.'}`,
  ].join(' ');
  const escalation = { status: 'not-filed', triggeringIssue: triggeringIssue || null, bugIssue: null, comment: issueComment };
  if (triggeringIssue) {
    const commentResult = await run('bd', ['comment', triggeringIssue, issueComment, '--json']);
    if (commentResult.code !== 0) {
      escalation.commentError = commentResult.stderr || commentResult.stdout;
    } else {
      escalation.status = 'commented';
    }
  }
  if (finalDiagnosis?.classification === 'suspected-test-issue') {
    escalation.status = triggeringIssue && !escalation.commentError ? 'suspected-test-issue-commented' : 'suspected-test-issue';
    return escalation;
  }
  if (!['product-bug', 'flake'].includes(finalDiagnosis?.classification)) return escalation;
  const details = [
    'Filed by the on-demand quality agent.',
    `Gate run ID: ${runId}`,
    `Failing check IDs: ${failed.map((check) => check.id).join(', ') || 'not reported'}`,
    `Measured vs expected: ${JSON.stringify(failed.map((check) => ({ id: check.id, measured: check.measured, threshold: check.threshold })))}`,
    `Artifact directory: ${artifactDir}`,
    `Hypothesis: ${(finalDiagnosis?.hypotheses ?? []).join(' | ') || 'none provided'}`,
    `Actions already attempted: ${actions.join(' | ') || 'none'}`,
    `Reproduction: ${failed[0]?.reproduce || gateCommand}`,
  ].join('\\n');
  const bugResult = await run('bd', [
    'create',
    `[agent] ${finalDiagnosis.classification}: ${finalDiagnosis.summary || 'quality gate failure'}`,
    '--description',
    details,
    '--type',
    'bug',
    '--priority',
    '1',
    '--labels',
    'agent-filed,triage,quality-gate',
    '--json',
  ]);
  if (bugResult.code !== 0) {
    escalation.bugError = bugResult.stderr || bugResult.stdout;
    return escalation;
  }
  try {
    escalation.bugIssue = JSON.parse(bugResult.stdout)[0]?.id ?? null;
  } catch {
    escalation.bugError = `Could not parse bd create output: ${bugResult.stdout}`;
  }
  if (escalation.bugIssue) escalation.status = 'bug-filed';
  return escalation;
}

async function gate(runNumber) {
  const gateDir = join(artifactDir, `gate-${runNumber}`);
  mkdirSync(gateDir, { recursive: true });
  const [command, ...args] = gateCommand.split(/\s+/);
  log(`Running gate attempt ${runNumber}: ${gateCommand}`);
  const result = await run(command, args, { QUALITY_GATE_ARTIFACT_DIR: gateDir, QUALITY_GATE_JSON: '1' });
  writeFileSync(join(gateDir, 'stdout.log'), result.stdout);
  writeFileSync(join(gateDir, 'stderr.log'), result.stderr);
  const report = parseGateReport(result.stdout);
  if (!report) throw new Error(`Gate did not emit a quality-gate/v1 report; inspect ${gateDir}`);
  return { result, report };
}

let diagnosis = null;
let finalGate = null;
let initialGate = null;
let escalation = null;
let classification = 'environment-infra';
try {
  for (let attempt = 1; attempt <= maxRuns; attempt += 1) {
    const current = await gate(attempt);
    if (!initialGate) initialGate = current.report;
    finalGate = current.report;
    if (current.report.passed) {
      classification = 'passed';
      log(`Gate passed on attempt ${attempt}`);
      break;
    }
    diagnosis = await askAgent(current.report, readableArtifacts(current.report));
    classification = diagnosis.classification;
    actions.push(...diagnosis.actions);
    log(`Diagnosis on attempt ${attempt}: ${diagnosis.classification} — ${diagnosis.summary}`);
    if (diagnosis.classification !== 'product-bug' || !diagnosis.patch) break;
    const applied = await applyPatch(diagnosis.patch);
    if (!applied.valid) {
      diagnosis = { ...diagnosis, classification: 'environment-infra', summary: `Patch rejected: ${applied.reason}`, hypotheses: [...diagnosis.hypotheses, applied.reason] };
      classification = diagnosis.classification;
      log(`Patch rejected: ${applied.reason}`);
      break;
    }
  }
} catch (error) {
  classification = 'environment-infra';
  diagnosis = { classification, summary: String(error), actions: [], patch: '', hypotheses: ['Inspect agent.log and retained gate artifacts.'] };
  log(`Agent stopped: ${String(error)}`);
}

if (!finalGate?.passed) {
  try {
    escalation = await fileEscalation(finalGate, diagnosis);
    log(`Escalation result: ${escalation.status}`);
  } catch (error) {
    escalation = { status: 'failed', triggeringIssue: triggeringIssue || null, error: String(error) };
    log(`Escalation failed: ${String(error)}`);
  }
}

const diff = (await run('git', ['diff', '--binary'])).stdout;
writeFileSync(join(artifactDir, 'applied.patch'), diff);
const report = {
  schemaVersion: 'quality-agent/v1',
  runId,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  model,
  maxRuns,
  classification,
  actions,
  diagnosis,
  escalation,
  gate: { before: initialGate, after: finalGate },
  artifacts: { directory: artifactDir, appliedPatch: join(artifactDir, 'applied.patch'), proposedPatch: join(artifactDir, 'proposed.patch'), log: join(artifactDir, 'agent.log') },
  remainingHypotheses: diagnosis?.hypotheses ?? [],
  passed: Boolean(finalGate?.passed),
};
writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = report.passed ? 0 : 1;
