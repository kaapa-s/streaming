---
description: Run the Beads coordinator for one issue on a retained implementation branch.
agent: coordinator
model: openrouter/openrouter/auto
---
Run exactly one coordinator issue from clean local main and retain its implementation branch for manual testing.

Use the supplied issue argument when present:

npm run run-issue -- --issue=$ARGUMENTS

Assume the gate passes on clean main and run it only after implementation, never as a baseline. Do not start another issue, commit, push, close the issue, or modify quality-gate or test files. Stop on dependency, verifier, reviewer, or quality-gate failures and report the preserved artifacts and precise human decision required.
