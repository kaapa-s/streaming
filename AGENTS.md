# Agent Coordination Protocol

This repository uses Beads issues and Herdr-managed Pi agents. The coordinator owns orchestration; workers own implementation of one assigned issue.

## Worker agents

- Work on exactly one Beads issue at a time. Read it first:
  `bd show <issue>`
- Claim it before editing:
  `bd update <issue> --claim`
- Inspect the current repository and existing changes before modifying files.
- Do not push remotely, reset unrelated changes, kill processes you did not start, or close the Beads issue unless the coordinator explicitly asks.
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

- If blocked, do not silently stop. Record the blocker with `bd comment` and clearly print `STATUS: BLOCKED`.
- If a test fails because of the environment, distinguish that from a product failure and include the exact command, error, and recovery attempted.
- Preserve useful failure artifacts unless cleanup is explicitly part of the test contract.

## Coordinator agents

- Assign one issue to one worker and use a dedicated Herdr pane. Prefer sequential work when tasks share harnesses or integration code.
- After starting or prompting a worker, wait for its lifecycle state with Herdr (`working`, `idle`, `done`, or `blocked`). Do not fire-and-forget a worker.
- For long-running work, poll at least every 30–60 seconds. When a worker becomes `idle` or `done`, immediately read its recent output and its Beads comment before reporting status to the user.
- Treat `idle` as “inspect now,” not as proof of success. Confirm the structured report, changed files, tests, and Beads state.
- Treat `blocked` as a user-facing event. Surface the exact decision, options, and recommendation; do not make an architectural or scope decision silently.
- If a worker is unresponsive, inspect output first, then send one focused follow-up. Interrupt or kill it only after recording why and preserving its work.
- Before starting the next issue, review the diff, run appropriate quality gates, and either close the completed issue or explain why it remains open.
- Do not claim an issue is complete based only on static checks when its acceptance criteria require a live integration run.
- Notify the user promptly on: completion, blocker, decision request, worker failure, environment recovery, or any change in scope.

## Handoff format

Coordinator updates to the user should contain:

1. Worker and issue status.
2. What changed or what was investigated.
3. Checks/results, including live-test status.
4. Any files or processes affected.
5. The next action and any explicit decision needed from the user.

Use Beads for task state and comments; do not create parallel TODO lists for coordination.
