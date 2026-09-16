# Agent Coordination Protocol

This repository uses Beads issues and Herdr-managed Pi agents. The coordinator owns orchestration; workers own implementation of one assigned issue.

## Worker agents

- Beads CLI 1.3.0+ is required. Its transactional close policy rejects closing a parent while any parent-child child remains open; `scripts/setup-local.sh` fails fast on older CLIs.
- Never modify quality gate code, the gate harness, or test files. If a gate check fails for product reasons, stop and report it; a human decides whether the gate or the product is wrong.
- Work on exactly one Beads issue at a time. Read it first:
  `bd show <issue>`
- Claim it before editing:
  `bd update <issue> --claim`
- Inspect the current repository and existing changes before modifying files.
- Do not commit or push code remotely, reset unrelated changes, kill processes you did not start, or close the Beads issue unless the coordinator explicitly asks.
- After changing Beads issues, publish the issue database for collaborators with `bd dolt push` (unless the coordinator explicitly asks you not to). This is separate from `git push`; do not try to add `.beads/embeddeddolt/` to Git.
- Keep changes scoped to the assigned issue. If another issue is needed, stop and report it as a dependency.
- Run relevant checks before reporting completion.
- Always leave a structured Beads comment before becoming idle:

```text
STATUS: DONE | BLOCKED | NEEDS_DECISION
ISSUE: <id>
SUMMARY: <short result>
CHANGED: <files or none>
CHECKS: <commands and outcomes>
BLOCKER: <none or exact blocker>
DECISION: <none or the precise question>
NEXT: <recommended coordinator action>
```

- If blocked, stop implementation at the blocker. Do not speculate by starting unrelated refactors or “helpful” follow-up fixes. Record the blocker with `bd comment` and clearly print `STATUS: BLOCKED` or `STATUS: NEEDS_DECISION`.
- If a test fails because of the environment, distinguish that from a product failure and include the exact command, error, and recovery attempted.
- Preserve useful failure artifacts unless cleanup is explicitly part of the test contract.

## Coordinator agents

- Assign one issue to one worker and use a dedicated Herdr pane. Prefer sequential work when tasks share harnesses or integration code.
- Never reuse an existing worker agent or its pane for a new issue or planning task; old agent context may be contaminated. Start a fresh agent in a fresh dedicated Herdr pane for every new assignment, even when an earlier agent is idle or done.
- After starting or prompting a worker, use `herdr agent prompt ... --wait --timeout ...` or immediately use `herdr agent wait ... --timeout ...`; do not fire-and-forget a worker. The coordinator's control command must remain active until the worker settles or the timeout is explicitly reported.
- For long-running work, poll at least every 30–60 seconds. When a worker becomes `idle`, `done`, or `blocked`, immediately read its recent output and its Beads comment before reporting status to the user. A worker's structured Beads comment is the authoritative handoff, but still verify its claims against git and test output.
- Treat `idle` as “inspect now,” not as proof of success. Confirm the structured report, changed files, tests, and Beads state.
- Treat `blocked` as a user-facing event. Surface the exact decision, options, and recommendation; do not make an architectural or scope decision silently.
- If a worker is unresponsive, inspect output first, then send one focused follow-up. Interrupt or kill it only after recording why and preserving its work. After killing a worker, immediately report that event and the preserved work to the user.
- Before starting the next issue, review the diff, run appropriate quality gates, and either close the completed issue or explain why it remains open.
- Do not claim an issue is complete based only on static checks when its acceptance criteria require a live integration run.
- Notify the user promptly on: completion, blocker, decision request, worker failure, environment recovery, or any change in scope.
- When the user explicitly authorizes committing and pushing the accepted work, have the relevant workers finalize their Beads comments/state and commits as directed, verify the handoff, then close only the worker agents/workspaces started by the coordinator so the Herdr UI stays clean. Preserve their output and artifacts before cleanup.

## Quality gates and the human stop point

The repository has deterministic local quality gates (see `docs/quality-gate-local.md`; run with `npm run quality-gate`). The gates were specified after the task descriptions and are authoritative. Tests and gate code are never touched without human supervision.

Stop point: the feature is implemented, the quality gate fails, and a human makes the call.

- When implementation work makes the quality gate fail (even if the feature itself looks done), the coordinator stops and reports to the user: failing check IDs, measured vs expected values, artifact directory, and worker status. This is a user-facing event; a failed gate is never reported as completion.
- No gate, test, or harness code is changed at this point, and no gate-update task is created yet.
- The human manually verifies the feature and decides:
  - the gate is wrong (gate/test needs updating), or
  - the implementation is wrong (fixing continues with the gate unchanged).
- Only after the human's explicit decision does the coordinator create a subtask under the currently fixed task to update the quality gate (or continue the fix), and only then assign it to a worker.
- Coordinator handoffs always state the gate result for the current change.

## Handoff format

Coordinator updates to the user should contain:

1. Worker and issue status.
2. What changed or what was investigated.
3. Checks/results, including live-test status.
4. Any files or processes affected.
5. The next action and any explicit decision needed from the user.

Use Beads for task state and comments; do not create parallel TODO lists for coordination.


<!-- BEGIN BEADS INTEGRATION v:1 profile:full hash:bacef91e -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Quality
- Use `--acceptance` and `--design` fields when creating issues
- Use `--validate` to check description completeness

### Lifecycle
- `bd defer <id>` / `bd supersede <id>` for issue management
- `bd stale` / `bd orphans` / `bd lint` for hygiene
- `bd human <id>` to flag for human decisions
- `bd formula list` / `bd mol pour <name>` for structured workflows

### Sync

bd stores issue history in Dolt:

- Each write auto-commits to Dolt history
- Use `bd dolt push`/`bd dolt pull` for remote sync
- Do not treat `.beads/issues.jsonl` as the sync protocol

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and https://github.com/gastownhall/beads/blob/main/docs/getting-started/quickstart.md.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.

<!-- END BEADS INTEGRATION -->
