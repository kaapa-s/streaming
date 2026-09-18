#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(new URL('..', import.meta.url).pathname);
const issueId = process.argv.find((value) => value.startsWith('--issue='))?.slice('--issue='.length);
const outputPath = process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length);
const commentEnabled = process.env.PLAN_COMMENT !== '0';
const agentEnabled = process.env.PLAN_AGENT !== '0';
const model = process.env.OPENROUTER_MODEL ?? 'openrouter/openrouter/auto';

if (!issueId) {
  process.stderr.write('Usage: npm run plan -- --issue=<epic> [--output=<path>]\n');
  process.exit(2);
}

function run(command, args) {
  return new Promise((finish) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => finish({ code: 1, stdout, stderr: `${stderr}${error}\n` }));
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`);
  }
}

async function bdJson(args, label) {
  const result = await run('bd', [...args, '--json', '--readonly']);
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  return parseJson(result.stdout, label);
}

function graphIssues(graph) {
  if (graph && typeof graph === 'object' && !Array.isArray(graph)) {
    if (graph.issues && typeof graph.issues === 'object') return Object.values(graph.issues);
    const values = Object.values(graph).filter((value) => value && typeof value === 'object' && value.Issue);
    if (values.length > 0) return values.map((value) => ({ ...value.Issue, dependsOn: value.DependsOn ?? [] }));
  }
  return [];
}

function issueRecord(value) {
  if (value?.Issue) return { ...value.Issue, dependsOn: value.DependsOn ?? [] };
  return value;
}

function textOf(issue) {
  return [issue.title, issue.description, issue.design, issue.acceptance_criteria, issue.notes].filter(Boolean).join('\n');
}

const pathPattern = /(?:^|[\s`'(])((?:server|sfu|web|compositor|shared|scripts|e2e|\.opencode)\/[A-Za-z0-9_./-]+)/g;
function claimedPaths(issue) {
  const paths = new Set();
  for (const match of textOf(issue).matchAll(pathPattern)) {
    const path = match[1].replace(/[),.;:]+$/, '');
    if (path && !path.endsWith('/')) paths.add(path);
  }
  return [...paths].sort();
}

function actionable(issue) {
  return issue && issue.id !== issueId && ['open', 'in_progress', 'blocked'].includes(issue.status);
}

function dependencyIds(issue) {
  return [...new Set([...(issue.dependsOn ?? []), ...(issue.dependencies ?? []).map((dependency) => dependency.id ?? dependency.issue_id ?? dependency.depends_on_id).filter(Boolean)])];
}

function mechanicalPlan(epic, graph) {
  const records = [epic, ...graphIssues(graph).map(issueRecord)].filter(Boolean);
  const byId = new Map(records.map((issue) => [issue.id, issue]));
  const nodes = records.filter(actionable).sort((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const deps = new Map(nodes.map((node) => [node.id, dependencyIds(node).filter((id) => nodeIds.has(id)).sort()]));
  const waves = [];
  const remaining = new Set(nodeIds);
  while (remaining.size > 0) {
    const wave = [...remaining].filter((id) => (deps.get(id) ?? []).every((dependency) => !remaining.has(dependency))).sort();
    if (wave.length === 0) {
      waves.push({ index: waves.length + 1, issues: [...remaining].sort(), status: 'blocked', source: 'mechanical' });
      break;
    }
    waves.push({ index: waves.length + 1, issues: wave, status: 'ready', source: 'mechanical' });
    wave.forEach((id) => remaining.delete(id));
  }

  const claims = nodes.map((issue) => ({ issue: issue.id, paths: claimedPaths(issue) }));
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const shared = claims[leftIndex].paths.filter((path) => claims[rightIndex].paths.includes(path));
      if (shared.length > 0) conflicts.push({ issues: [claims[leftIndex].issue, claims[rightIndex].issue], paths: shared.sort(), source: 'mechanical' });
    }
  }

  const acGaps = [];
  const stopGaps = [];
  const humanGates = [];
  for (const issue of nodes) {
    const text = textOf(issue);
    if (!issue.acceptance_criteria?.trim()) acGaps.push({ issue: issue.id, reason: 'missing acceptance criteria', source: 'mechanical' });
    if (!/(?:stop condition|stop when|gate:|halt|human decision|blocked|escalat)/i.test(text)) stopGaps.push({ issue: issue.id, reason: 'no explicit stop condition or gate', source: 'mechanical' });
    if (issue.issue_type === 'decision' || /(?:owner decision|human decision|needs decision|ambiguous|conditional|product decision)/i.test(text)) humanGates.push({ issue: issue.id, reason: issue.issue_type === 'decision' ? 'decision issue requires resolution' : 'text contains an unresolved decision cue', source: 'mechanical' });
  }
  const missingDependencies = nodes.flatMap((issue) => dependencyIds(issue).filter((id) => !byId.has(id)).map((id) => ({ issue: issue.id, dependency: id, source: 'mechanical' })));
  return { waves, claims, conflicts, acceptanceCriteriaGaps: acGaps, stopConditionGaps: stopGaps, humanGates, missingDependencies };
}

async function runPlannerAgent(context) {
  if (!agentEnabled || !process.env.OPENROUTER_API_KEY) return { status: 'skipped', reason: 'OPENROUTER_API_KEY is not configured', findings: [] };
  const prompt = JSON.stringify({ task: 'Review this execution plan for judgment-only risks. Return JSON with findings, humanGates, and stopConditions arrays. Do not invent product decisions.', plan: context });
  const result = await run(process.env.OPENCODE_BIN ?? 'opencode', ['run', '--agent', 'planner', '--model', model, '--format', 'json', prompt]);
  if (result.code !== 0) return { status: 'failed', reason: result.stderr || result.stdout, findings: [] };
  const lines = result.stdout.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') return { status: 'passed', findings: value.findings ?? [], humanGates: value.humanGates ?? [], stopConditions: value.stopConditions ?? [] };
    } catch {}
  }
  return { status: 'failed', reason: 'planner agent did not return JSON', findings: [] };
}

const epicPayload = await bdJson(['show', issueId], `bd show ${issueId}`);
const graphPayload = await bdJson(['graph', issueId], `bd graph ${issueId}`);
const epic = Array.isArray(epicPayload) ? epicPayload[0] : epicPayload;
const mechanical = mechanicalPlan(epic, graphPayload);
const agent = await runPlannerAgent({ epic: { id: epic.id, title: epic.title }, ...mechanical });
const report = {
  schemaVersion: 'plan/v1',
  issue: { id: epic.id, title: epic.title, status: epic.status },
  source: { commands: [`bd show ${issueId} --json`, `bd graph ${issueId} --json`], checkout: process.cwd() },
  waves: mechanical.waves,
  ownership: mechanical.claims,
  conflicts: mechanical.conflicts,
  acceptanceCriteriaGaps: mechanical.acceptanceCriteriaGaps,
  stopConditionGaps: mechanical.stopConditionGaps,
  humanGates: mechanical.humanGates,
  missingDependencies: mechanical.missingDependencies,
  agent: { status: agent.status, reason: agent.reason ?? null },
  agentFindings: (agent.findings ?? []).map((finding) => ({ ...finding, source: 'agent' })),
  agentHumanGates: (agent.humanGates ?? []).map((finding) => ({ ...finding, source: 'agent' })),
  agentStopConditions: (agent.stopConditions ?? []).map((finding) => ({ ...finding, source: 'agent' })),
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const target = resolve(outputPath);
  writeFileSync(target, serialized);
  process.stderr.write(`Plan written to ${target}\n`);
}
let commentResult = null;
if (!outputPath && commentEnabled) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-v1-'));
  const reportPath = join(dir, `${issueId}.json`);
  writeFileSync(reportPath, serialized);
  commentResult = await run('bd', ['comment', issueId, '--file', reportPath, '--json']);
  rmSync(dir, { recursive: true, force: true });
  if (commentResult.code !== 0) throw new Error(`Beads plan comment failed: ${commentResult.stderr || commentResult.stdout}`);
  process.stderr.write(`Plan[v1] posted as a comment on ${issueId}\n`);
}
process.stdout.write(serialized);
