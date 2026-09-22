# Agent Coordination Protocol

This repository uses GitHub Issues and Herdr-managed Pi agents. The coordinator owns orchestration; workers own implementation of one assigned issue.

## Worker agents

- The `gh` CLI is required and must be authenticated (`gh auth status`). Issues live in `kaapa-s/streaming` on GitHub; see `docs/agents/issue-tracker.md` for conventions.
- Never modify quality gate code, the gate harness, or test files. If a gate check fails for product reasons, stop and report it; a human decides whether the gate or the product is wrong.
- Work on exactly one GitHub issue at a time. Read it first:
  `gh issue view <number> --comments`
- Claim it before editing:
  `gh issue edit <number> --add-assignee @me`
- Inspect the current repository and existing changes before modifying files.
- Do not commit or push code remotely, reset unrelated changes, kill processes you did not start, or close the GitHub issue unless the coordinator explicitly asks.
- Keep changes scoped to the assigned issue. If another issue is needed, stop and report it as a dependency.
- Run relevant checks before reporting completion.
- Always leave a structured comment on the issue (`gh issue comment <number> --body "..."`) before becoming idle:

```text
STATUS: DONE | BLOCKED | NEEDS_DECISION
ISSUE: <number>
SUMMARY: <short result>
CHANGED: <files or none>
CHECKS: <commands and outcomes>
BLOCKER: <none or exact blocker>
DECISION: <none or the precise question>
NEXT: <recommended coordinator action>
```

- If blocked, stop implementation at the blocker. Do not speculate by starting unrelated refactors or “helpful” follow-up fixes. Record the blocker with `gh issue comment` and clearly print `STATUS: BLOCKED` or `STATUS: NEEDS_DECISION`.
- If a test fails because of the environment, distinguish that from a product failure and include the exact command, error, and recovery attempted.
- Preserve useful failure artifacts unless cleanup is explicitly part of the test contract.

## Coordinator agents

- Assign one issue to one worker and use a dedicated Herdr pane. Prefer sequential work when tasks share harnesses or integration code.
- Never reuse an existing worker agent or its pane for a new issue or planning task; old agent context may be contaminated. Start a fresh agent in a fresh dedicated Herdr pane for every new assignment, even when an earlier agent is idle or done.
- After starting or prompting a worker, use `herdr agent prompt ... --wait --timeout ...` or immediately use `herdr agent wait ... --timeout ...`; do not fire-and-forget a worker. The coordinator's control command must remain active until the worker settles or the timeout is explicitly reported.
- For long-running work, poll at least every 30–60 seconds. When a worker becomes `idle`, `done`, or `blocked`, immediately read its recent output and its issue comment before reporting status to the user. A worker's structured issue comment is the authoritative handoff, but still verify its claims against git and test output.
- Treat `idle` as “inspect now,” not as proof of success. Confirm the structured report, changed files, tests, and issue state.
- Treat `blocked` as a user-facing event. Surface the exact decision, options, and recommendation; do not make an architectural or scope decision silently.
- If a worker is unresponsive, inspect output first, then send one focused follow-up. Interrupt or kill it only after recording why and preserving its work. After killing a worker, immediately report that event and the preserved work to the user.
- After the current issue's implementation is complete, review the diff and run the appropriate quality gates, then either close the completed issue (`gh issue close <number> --comment "..."`) or explain why it remains open. Do not run gates as a pre-implementation baseline.
- Do not claim an issue is complete based only on static checks when its acceptance criteria require a live integration run.
- Notify the user promptly on: completion, blocker, decision request, worker failure, environment recovery, or any change in scope.
- When the user explicitly authorizes committing and pushing the accepted work, have the relevant workers finalize their issue comments/state and commits as directed, verify the handoff, then close only the worker agents/workspaces started by the coordinator so the Herdr UI stays clean. Preserve their output and artifacts before cleanup.

## Quality gates and the human stop point

The repository has deterministic local quality gates (see `docs/quality-gate-local.md`; run with `npm run quality-gate`). The gates were specified after the task descriptions and are authoritative. Tests and gate code are never touched without human supervision.

Assume a clean checkout passes the gate. Do not run the gate, or any baseline verification, before implementation; run it only after the implementation is complete.

Stop point: the feature is implemented, the quality gate fails, and a human makes the call.

- When implementation work makes the quality gate fail (even if the feature itself looks done), the coordinator stops and reports to the user: failing check IDs, measured vs expected values, artifact directory, and worker status. This is a user-facing event; a failed gate is never reported as completion.
- No gate, test, or harness code is changed at this point, and no gate-update task is created yet.
- The human manually verifies the feature and decides:
  - the gate is wrong (gate/test needs updating), or
  - the implementation is wrong (fixing continues with the gate unchanged).
- Only after the human's explicit decision does the coordinator create a follow-up issue linked to the current one to update the quality gate (or continue the fix), and only then assign it to a worker.
- Coordinator handoffs always state the gate result for the current change.

## Handoff format

Coordinator updates to the user should contain:

1. Worker and issue status.
2. What changed or what was investigated.
3. Checks/results, including live-test status.
4. Any files or processes affected.
5. The next action and any explicit decision needed from the user.

Use GitHub Issues for task state and comments; do not create parallel TODO lists for coordination.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `kaapa-s/streaming`, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
